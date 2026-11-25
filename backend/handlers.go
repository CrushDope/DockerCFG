package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// dockerRequest 通过 docker.sock 直接调用 Docker Engine API。
// 不依赖 docker CLI 读取容器状态。
func dockerRequest(ctx context.Context, method, endpoint string, body any) ([]byte, error) {
	var payload []byte
	var err error
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if body != nil {
		req.ContentLength = int64(len(payload))
	}

	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", cfg.DockerSocket)
		},
	}
	defer transport.CloseIdleConnections()
	resp, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("Docker 请求失败: %w", err)
	}
	defer resp.Body.Close()

	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Docker API %d: %s", resp.StatusCode, strings.TrimSpace(buf.String()))
	}
	return buf.Bytes(), nil
}

func pingDocker() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := dockerRequest(ctx, "GET", "/_ping", nil)
	return err == nil
}

// 基础容器接口使用守护进程报告的版本，避免写死版本导致新旧 NAS 不兼容。
func dockerAPIPrefix(ctx context.Context) (string, error) {
	raw, err := dockerRequest(ctx, http.MethodGet, "/version", nil)
	if err != nil {
		return "", err
	}
	return parseDockerAPIPrefix(raw)
}

var dockerAPIVersion = regexp.MustCompile(`^1\.[0-9]+$`)
var dockerContainerID = regexp.MustCompile(`^[a-f0-9]{12,64}$`)

func parseDockerAPIPrefix(raw []byte) (string, error) {
	var version struct {
		API string `json:"ApiVersion"`
	}
	if err := json.Unmarshal(raw, &version); err != nil {
		return "", err
	}
	if !dockerAPIVersion.MatchString(version.API) {
		return "", fmt.Errorf("Docker API 版本不可用")
	}
	return "/v" + version.API, nil
}

type dockerContainer struct {
	ID     string            `json:"Id"`
	Names  []string          `json:"Names"`
	Image  string            `json:"Image"`
	State  string            `json:"State"`
	Status string            `json:"Status"`
	Labels map[string]string `json:"Labels"`
}

type containerSummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Service    string `json:"service"`
	State      string `json:"state"`
	Status     string `json:"status"`
	Image      string `json:"image"`
	ConfigFile string `json:"configFile"`
}

func listContainers() ([]dockerContainer, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	prefix, err := dockerAPIPrefix(ctx)
	if err != nil {
		return nil, err
	}
	data, err := dockerRequest(ctx, "GET", prefix+"/containers/json?all=1", nil)
	if err != nil {
		return nil, err
	}
	var out []dockerContainer
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func groupContainersByProject(containers []dockerContainer) map[string][]containerSummary {
	m := map[string][]containerSummary{}
	for _, c := range containers {
		project := c.Labels["com.docker.compose.project"]
		if project == "" {
			continue
		}
		names := make([]string, 0, len(c.Names))
		for _, n := range c.Names {
			names = append(names, strings.TrimPrefix(n, "/"))
		}
		m[project] = append(m[project], containerSummary{
			ID:         c.ID,
			Name:       strings.Join(names, ", "),
			Service:    c.Labels["com.docker.compose.service"],
			State:      c.State,
			Status:     c.Status,
			Image:      c.Image,
			ConfigFile: c.Labels["com.docker.compose.project.config_files"],
		})
	}
	return m
}

// containerAction 单容器启停
func containerAction(requestCtx context.Context, id, action string) error {
	if !dockerContainerID.MatchString(id) {
		return fmt.Errorf("无效容器 ID")
	}
	switch action {
	case "start", "stop", "restart":
	default:
		return fmt.Errorf("不支持的操作: %s", action)
	}
	ctx, cancel := context.WithTimeout(requestCtx, 55*time.Second)
	defer cancel()
	prefix, err := dockerAPIPrefix(ctx)
	if err != nil {
		return err
	}
	endpoint := prefix + "/containers/" + id + "/" + action
	if action == "stop" {
		endpoint += "?t=10"
	}
	_, err = dockerRequest(ctx, "POST", endpoint, nil)
	return err
}

// projectAction 项目级 compose 操作，通过 docker CLI 执行。
func projectAction(requestCtx context.Context, projectName, action string) (string, error) {
	switch action {
	case "up", "down", "restart", "pull":
	default:
		return "", fmt.Errorf("不支持的操作: %s", action)
	}
	projectDir, err := safeJoin(cfg.ComposeRoot, projectName)
	if err != nil {
		return "", err
	}
	cf, ok := findComposeFile(projectDir)
	if !ok {
		return "", fmt.Errorf("未找到 compose 文件")
	}
	if err := checkProjectActionName(projectName, cf); err != nil {
		return "", err
	}
	args := []string{"compose", "-f", cf, "-p", projectName}
	switch action {
	case "up":
		args = append(args, "up", "-d")
	case "down":
		args = append(args, "down", "--remove-orphans")
	case "restart":
		args = append(args, "restart")
	case "pull":
		args = append(args, "pull")
	}

	ctx, cancel := context.WithTimeout(requestCtx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = filepath.Dir(cf)
	cmd.Env = append(cmd.Environ(), "DOCKER_HOST=unix://"+cfg.DockerSocket)
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if msg == "" {
			msg = strings.TrimSpace(outBuf.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return strings.TrimSpace(outBuf.String() + errBuf.String()), nil
}

// 操作明确依赖目录名；发现项目使用了不同的 Compose 名称时停止，避免对错误目标操作。
func checkProjectActionName(name, composePath string) error {
	if !projectNamePattern.MatchString(name) {
		return fmt.Errorf("目录名不符合 Compose 项目名称规则，请通过原部署方式操作")
	}
	raw, err := readRegularFile(composePath)
	if err != nil {
		return err
	}
	var doc struct {
		Name string `yaml:"name"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("无法读取 Compose 项目名: %w", err)
	}
	if doc.Name != "" && doc.Name != name {
		return fmt.Errorf("Compose 顶层 name 与项目目录名不同，请通过原部署方式操作")
	}
	if envName := envMap(readEnvFile(filepath.Dir(composePath)).Variables)["COMPOSE_PROJECT_NAME"]; envName != "" && envName != name {
		return fmt.Errorf(".env 中的 COMPOSE_PROJECT_NAME 与项目目录名不同，请通过原部署方式操作")
	}
	return nil
}

// ---------- 处理器 ----------

func handleOverview(w http.ResponseWriter, r *http.Request) {
	projects, err := scanProjects()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	cs, dockerErr := listContainers()
	dockerOK := dockerErr == nil
	grouped := groupContainersByProject(cs)
	for _, p := range projects {
		name := p["name"].(string)
		cs := grouped[name]
		running := 0
		for _, c := range cs {
			if c.State == "running" {
				running++
			}
		}
		state := "no-container"
		switch {
		case !dockerOK:
			state = "unknown"
		case len(cs) == 0:
		case running == len(cs):
			state = "running"
		case running > 0:
			state = "partial"
		default:
			state = "stopped"
		}
		// Docker 未连接时 cs 为 nil，序列化会变成 null；统一成空数组，前端可直接遍历
		if cs == nil {
			cs = []containerSummary{}
		}
		p["containers"] = cs
		p["runningCount"] = running
		p["state"] = state
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"projects":    projects,
		"dockerOk":    dockerOK,
		"composeRoot": cfg.ComposeRoot,
	})
}

func handleGetProject(w http.ResponseWriter, r *http.Request) {
	info, err := parseProject(r.PathValue("name"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func handleSaveCompose(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content    string   `json:"content"`
		EnvUpdates []EnvVar `json:"envUpdates"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	res, err := saveComposeConfig(r.PathValue("name"), body.Content, body.EnvUpdates)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func handleSaveEnv(w http.ResponseWriter, r *http.Request) {
	var req SaveEnvRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	res, err := saveEnvironment(r.PathValue("name"), req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func handleSaveEnvRaw(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content *string `json:"content"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil || body.Content == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if err := saveEnvRaw(r.PathValue("name"), *body.Content); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req CreateProjectRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	res, err := createProject(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func handleProjectAction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	// pull / up 可以超过普通 HTTP 写入超时。
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(5*time.Minute + 10*time.Second))
	output, err := projectAction(r.Context(), r.PathValue("name"), body.Action)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "output": output})
}

func handleContainerAction(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	if err := containerAction(r.Context(), r.PathValue("id"), body.Action); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleDockerStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": pingDocker()})
}
