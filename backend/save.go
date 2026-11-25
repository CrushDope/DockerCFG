package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

// SaveEnvRequest 保存环境变量的请求。
// Env 里的每项带 isRef 标记：
//   isRef=true  → 值写入 .env 文件，compose 中保持 ${KEY} 引用
//   isRef=false → 值直接写入 compose 文件
type SaveEnvRequest struct {
	Service string   `json:"service"`
	Env     []EnvVar `json:"env"`
}

// saveEnvironment 按引用关系分别落盘。
// 关键：引用型变量（${VAR}）的值写入 .env，compose 中保留占位符；
// 字面量直接写进 compose，不污染 .env。
var saveMu sync.Mutex

func saveEnvironment(projectName string, req SaveEnvRequest) (map[string]any, error) {
	saveMu.Lock()
	defer saveMu.Unlock()
	projectDir, err := safeJoin(cfg.ComposeRoot, projectName)
	if err != nil {
		return nil, err
	}
	cf, ok := findComposeFile(projectDir)
	if !ok {
		return nil, fmt.Errorf("未找到 compose 文件")
	}
	raw, err := os.ReadFile(cf)
	if err != nil {
		return nil, err
	}

	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("compose YAML 解析失败: %w", err)
	}
	if len(doc.Content) == 0 {
		return nil, fmt.Errorf("compose 文件为空")
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("compose 文件格式不正确")
	}

	servicesVal := mapValue(root, "services")
	if servicesVal == nil {
		return nil, fmt.Errorf("compose 中没有 services")
	}
	svc := mapValue(servicesVal, req.Service)
	if svc == nil || svc.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("服务 %s 不存在", req.Service)
	}

	// 读取现有 .env，保留注释与顺序
	envPath := filepath.Join(filepath.Dir(cf), ".env")
	envRaw, err := readRegularFile(envPath)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	envVars := parseEnvVars(string(envRaw))
	envIdx := map[string]int{}
	for i, v := range envVars {
		envIdx[v.Key] = i
	}

	// 分别收集
	composeEntries := map[string]string{}
	refEntries := map[string]string{}
	var refOrder []string
	for _, e := range req.Env {
		if e.Key == "" {
			continue
		}
		if e.IsRef {
			key := e.RefKey
			if key == "" {
				key = e.Key
			}
			if err := validateEnvUpdate(EnvVar{Key: key, Value: e.Value}); err != nil {
				return nil, err
			}
			refEntries[key] = e.Value
			refOrder = append(refOrder, key)
		} else {
			composeEntries[e.Key] = e.Value
		}
	}

	// 1) 更新 .env：引用型变量写入（或更新）对应行
	//    只改动本次请求涉及的变量，其余 .env 变量原样保留
	for _, key := range refOrder {
		val := refEntries[key]
		if i, ok := envIdx[key]; ok {
			envVars[i].Value = val
		} else {
			envVars = append(envVars, EnvVar{Key: key, Value: val})
			envIdx[key] = len(envVars) - 1
		}
	}
	// 仅把受影响的引用型变量交给 mergeEnvContent，其余原样保留
	affected := map[string]bool{}
	for _, key := range refOrder {
		affected[key] = true
	}
	envUpdates := make([]EnvVar, 0, len(refOrder))
	for _, v := range envVars {
		if affected[v.Key] {
			envUpdates = append(envUpdates, v)
		}
	}

	// 2) 更新 compose 的 environment：
	//    - 引用型 → 写回 ${KEY} 形式（保留默认值的写法）
	//    - 字面量 → 写回具体值
	newEnv := map[string]string{}
	for _, e := range req.Env {
		if e.Key == "" {
			continue
		}
		if e.IsRef {
			key := e.RefKey
			if key == "" {
				key = e.Key
			}
			if e.HasDefault {
				newEnv[e.Key] = "${" + key + ":-" + e.Default + "}"
			} else {
				newEnv[e.Key] = "${" + key + "}"
			}
		} else {
			newEnv[e.Key] = e.Value
		}
	}
	setMapValue(svc, "environment", newEnv)

	// 3) 写回 compose（使用 2 空格缩进，与手写风格一致）
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&doc); err != nil {
		return nil, err
	}
	enc.Close()
	if err := writeComposeAndEnv(cf, buf.Bytes(), envPath, envRaw, envUpdates); err != nil {
		return nil, err
	}

	return map[string]any{
		"ok":             true,
		"envUpdated":     refOrder,
		"composeUpdated": len(composeEntries),
	}, nil
}

// mergeEnvContent 在保留原有注释/空行/顺序的前提下更新变量值。
// 已存在的键就地替换，新键追加到末尾。
func mergeEnvContent(original string, vars []EnvVar) string {
	lookup := map[string]string{}
	for _, v := range vars {
		lookup[v.Key] = v.Value
	}
	lines := strings.Split(original, "\n")
	// 原文件为空时不应产生空行
	if original == "" {
		lines = nil
	}
	seen := map[string]bool{}
	// dropped 标记因去重而需要删除的行（与原文件自带的空行区分开）
	dropped := make([]bool, len(lines))
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		idx := strings.Index(t, "=")
		if idx == -1 {
			continue
		}
		key := strings.TrimSpace(strings.TrimPrefix(t[:idx], "export "))
		val, ok := lookup[key]
		if !ok {
			continue
		}
		if seen[key] {
			// 原文件里同一键重复出现，删掉后面的重复行
			dropped[i] = true
			continue
		}
		lines[i] = fmt.Sprintf("%s=%s", key, val)
		seen[key] = true
	}
	// 追加原文件中不存在的变量
	trailing := []string{}
	for _, v := range vars {
		if !seen[v.Key] {
			trailing = append(trailing, fmt.Sprintf("%s=%s", v.Key, v.Value))
			seen[v.Key] = true
		}
	}
	// 只移除因去重而标记的行，保留原文件自带的空行与注释
	kept := make([]string, 0, len(lines))
	for i, l := range lines {
		if dropped[i] {
			continue
		}
		kept = append(kept, l)
	}
	result := strings.Join(kept, "\n")
	if len(trailing) > 0 {
		if result != "" && !strings.HasSuffix(result, "\n") {
			result += "\n"
		}
		result += strings.Join(trailing, "\n") + "\n"
	}
	return result
}

// ---------- 保存 compose 源码 ----------

func saveComposeConfig(projectName, content string, updates []EnvVar) (map[string]any, error) {
	saveMu.Lock()
	defer saveMu.Unlock()
	var probe map[string]any
	if err := yaml.Unmarshal([]byte(content), &probe); err != nil {
		return nil, fmt.Errorf("YAML 格式错误: %w", err)
	}
	services, ok := probe["services"].(map[string]any)
	if !ok || len(services) == 0 {
		return nil, fmt.Errorf("Compose 文件必须定义至少一个服务")
	}
	projectDir, err := safeJoin(cfg.ComposeRoot, projectName)
	if err != nil {
		return nil, err
	}
	cf, ok := findComposeFile(projectDir)
	if !ok {
		return nil, fmt.Errorf("未找到 compose 文件")
	}
	envPath := filepath.Join(filepath.Dir(cf), ".env")
	var original []byte
	if len(updates) > 0 {
		for _, update := range updates {
			if err := validateEnvUpdate(update); err != nil {
				return nil, err
			}
		}
		original, err = readRegularFile(envPath)
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	if err := writeComposeAndEnv(cf, []byte(content), envPath, original, updates); err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "path": relToRoot(cf)}, nil
}

var envKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validateEnvUpdate(update EnvVar) error {
	if !envKeyPattern.MatchString(update.Key) {
		return fmt.Errorf("无效的 .env 变量名：%s", update.Key)
	}
	// 复杂值使用源码编辑，避免简单的 KEY=value 合并改变其语义。
	if strings.ContainsAny(update.Value, "\x00\r\n$'\"") || strings.TrimSpace(update.Value) != update.Value || strings.Contains(update.Value, " #") || strings.Contains(update.Value, "\t#") {
		return fmt.Errorf("变量 %s 包含需要转义的字符，请在 .env 源码中编辑其值", update.Key)
	}
	return nil
}

func saveEnvRaw(projectName, content string) error {
	saveMu.Lock()
	defer saveMu.Unlock()
	if strings.ContainsRune(content, 0) {
		return fmt.Errorf(".env 不能包含 NUL 字符")
	}
	dir, err := safeJoin(cfg.ComposeRoot, projectName)
	if err != nil {
		return err
	}
	cf, ok := findComposeFile(dir)
	if !ok {
		return fmt.Errorf("未找到 compose 文件")
	}
	path := filepath.Join(filepath.Dir(cf), ".env")
	temp, err := stageFile(path, []byte(content), 0600)
	if err != nil {
		return err
	}
	defer os.Remove(temp)
	return os.Rename(temp, path)
}

// 先完成两份临时文件的写入，再替换目标；替换第二份失败时回滚 .env。
func writeComposeAndEnv(composePath string, content []byte, envPath string, original []byte, updates []EnvVar) error {
	composeTemp, err := stageFile(composePath, content, 0644)
	if err != nil {
		return err
	}
	defer os.Remove(composeTemp)
	if len(updates) == 0 {
		return os.Rename(composeTemp, composePath)
	}
	envTemp, err := stageFile(envPath, []byte(mergeEnvContent(string(original), updates)), 0600)
	if err != nil {
		return err
	}
	defer os.Remove(envTemp)
	var backup string
	if original != nil {
		backup, err = stageFile(envPath, original, 0600)
		if err != nil {
			return err
		}
		defer os.Remove(backup)
	}
	if err := os.Rename(envTemp, envPath); err != nil {
		return err
	}
	if err := os.Rename(composeTemp, composePath); err != nil {
		var rollback error
		if backup == "" {
			rollback = os.Remove(envPath)
		} else {
			rollback = os.Rename(backup, envPath)
		}
		if rollback != nil {
			return fmt.Errorf("Compose 保存失败 (%v)，.env 回滚失败: %w", err, rollback)
		}
		return err
	}
	return nil
}

func stageFile(path string, content []byte, mode os.FileMode) (temp string, err error) {
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("不是普通文件：%s", filepath.Base(path))
		}
		mode = info.Mode().Perm()
	} else if !os.IsNotExist(err) {
		return "", err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".dockercfg-*")
	if err != nil {
		return "", err
	}
	name := f.Name()
	defer func() {
		if err != nil {
			_ = f.Close()
			_ = os.Remove(name)
		}
	}()
	if err := f.Chmod(mode); err != nil {
		return "", err
	}
	if _, err := f.Write(content); err != nil {
		return "", err
	}
	if err := f.Sync(); err != nil {
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return name, nil
}

// ---------- 新建项目 ----------

type CreateProjectRequest struct {
	Name          string       `json:"name"`
	ServiceName   string       `json:"serviceName"`
	Image         string       `json:"image"`
	ContainerName string       `json:"containerName"`
	Restart       string       `json:"restart"`
	Ports         []PortSpec   `json:"ports"`
	Volumes       []VolumeSpec `json:"volumes"`
	Environment   []EnvVar     `json:"environment"`
	Env           string       `json:"env"`
	// 完整 compose 内容（表单编辑模式下的其他字段）
	Compose map[string]any `json:"compose"`
}

type PortSpec struct {
	Host      string `json:"host"`
	Container string `json:"container"`
	Protocol  string `json:"protocol"`
}

type VolumeSpec struct {
	Source   string `json:"source"`
	Target   string `json:"target"`
	ReadOnly bool   `json:"readOnly"`
}

var projectNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

func createProject(req CreateProjectRequest) (map[string]any, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("项目名不能为空")
	}
	if !projectNamePattern.MatchString(name) || name == "data" || name == "backup" || name == "node_modules" {
		return nil, fmt.Errorf("项目名必须以小写字母或数字开头，只能包含小写字母、数字、下划线和短横线，不能使用保留目录名")
	}
	projectDir, err := safeJoin(cfg.ComposeRoot, name)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(projectDir); err == nil {
		return nil, fmt.Errorf("项目「%s」已存在", name)
	}
	if err := os.Mkdir(projectDir, 0755); err != nil {
		return nil, err
	}

	svcName := strings.TrimSpace(req.ServiceName)
	if svcName == "" {
		svcName = name
	}
	svcName = regexp.MustCompile(`[^\w.-]`).ReplaceAllString(svcName, "_")

	svc := map[string]any{}
	if req.Image != "" {
		svc["image"] = req.Image
	}
	if req.ContainerName != "" {
		svc["container_name"] = req.ContainerName
	}
	if req.Restart != "" {
		svc["restart"] = req.Restart
	}
	var ports []string
	for _, p := range req.Ports {
		if p.Host == "" || p.Container == "" {
			continue
		}
		if p.Protocol != "" && p.Protocol != "tcp" {
			ports = append(ports, fmt.Sprintf("%s:%s/%s", p.Host, p.Container, p.Protocol))
		} else {
			ports = append(ports, fmt.Sprintf("%s:%s", p.Host, p.Container))
		}
	}
	if len(ports) > 0 {
		svc["ports"] = ports
	}
	var volumes []string
	for _, v := range req.Volumes {
		if v.Source == "" || v.Target == "" {
			continue
		}
		s := fmt.Sprintf("%s:%s", v.Source, v.Target)
		if v.ReadOnly {
			s += ":ro"
		}
		volumes = append(volumes, s)

	}
	if len(volumes) > 0 {
		svc["volumes"] = volumes
	}
	envMapOut := map[string]string{}
	for _, e := range req.Environment {
		if e.Key == "" {
			continue
		}
		envMapOut[e.Key] = e.Value
	}
	if len(envMapOut) > 0 {
		svc["environment"] = envMapOut
	}

	doc := map[string]any{
		"services": map[string]any{svcName: svc},
	}
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(doc); err != nil {
		return nil, err
	}
	enc.Close()
	cf := filepath.Join(projectDir, "docker-compose.yml")
	if err := os.WriteFile(cf, buf.Bytes(), 0644); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Env) != "" {
		if err := os.WriteFile(filepath.Join(projectDir, ".env"), []byte(req.Env), 0600); err != nil {
			return nil, err
		}
	}
	return map[string]any{"ok": true, "name": name, "composePath": relToRoot(cf)}, nil
}

// ---------- yaml.Node 操作辅助 ----------

func mapValue(node *yaml.Node, key string) *yaml.Node {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func setMapValue(node *yaml.Node, key string, value any) {
	if node == nil || node.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			v, err := yaml.Marshal(value)
			if err != nil {
				return
			}
			var vn yaml.Node
			if err := yaml.Unmarshal(v, &vn); err != nil {
				return
			}
			node.Content[i+1] = vn.Content[0]
			return
		}
	}
	// 不存在则追加
	kn := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}
	v, err := yaml.Marshal(value)
	if err != nil {
		return
	}
	var vn yaml.Node
	if err := yaml.Unmarshal(v, &vn); err != nil {
		return
	}
	node.Content = append(node.Content, kn, vn.Content[0])
}

// sortedKeys 保持 map 键有序输出
func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
