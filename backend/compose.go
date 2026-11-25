package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

var composeNames = []string{
	"docker-compose.yml", "docker-compose.yaml",
	"compose.yml", "compose.yaml",
}

// ---------- 数据结构 ----------

type EnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	// IsRef 表示 compose 中写的是 ${VAR} 形式，实际值来自 .env
	IsRef  bool   `json:"isRef"`
	RefKey string `json:"refKey,omitempty"`
	Raw    string `json:"raw"` // compose 中的原始写法
	// Default 是 ${VAR:-default} 中的默认值
	Default    string `json:"default,omitempty"`
	HasDefault bool   `json:"hasDefault,omitempty"`
}

type ServiceInfo struct {
	Name        string         `json:"name"`
	Image       string         `json:"image"`
	EnvFile     []string       `json:"envFile"`
	Environment []EnvVar       `json:"environment"`
	Config      map[string]any `json:"config"`
	Raw         map[string]any `json:"raw"`
}

type ProjectInfo struct {
	Name        string         `json:"name"`
	ComposePath string         `json:"composePath"`
	ComposeRaw  string         `json:"composeRaw"`
	Compose     map[string]any `json:"compose"`
	ParseError  string         `json:"parseError,omitempty"`
	Env         EnvFileInfo    `json:"env"`
	Services    []ServiceInfo  `json:"services"`
	UpdatedAt   string         `json:"updatedAt"`
}

type EnvFileInfo struct {
	Exists    bool     `json:"exists"`
	Raw       string   `json:"raw"`
	Variables []EnvVar `json:"variables"`
}

// ---------- 扫描 ----------

func findComposeFile(dir string) (string, bool) {
	for _, n := range composeNames {
		p := filepath.Join(dir, n)
		if st, err := os.Lstat(p); err == nil && st.Mode().IsRegular() {
			return p, true
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		for _, n := range composeNames {
			p := filepath.Join(dir, e.Name(), n)
			if st, err := os.Lstat(p); err == nil && st.Mode().IsRegular() {
				return p, true
			}
		}
	}
	return "", false
}

func scanProjects() ([]map[string]any, error) {
	entries, err := os.ReadDir(cfg.ComposeRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	out := []map[string]any{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		switch e.Name() {
		case "node_modules", "data", "backup":
			continue
		}
		projectDir := filepath.Join(cfg.ComposeRoot, e.Name())
		cf, ok := findComposeFile(projectDir)
		if !ok {
			continue
		}
		raw, err := os.ReadFile(cf)
		if err != nil {
			continue
		}
		svcNames, parseErr := parseServiceNames(string(raw))
		st, _ := os.Stat(cf)

		updated := ""
		if st != nil {
			updated = st.ModTime().Format("2006-01-02T15:04:05Z07:00")
		}
		out = append(out, map[string]any{
			"name":            e.Name(),
			"composePath":     relToRoot(cf),
			"composeFileName": filepath.Base(cf),
			"envPath":         envRelPath(filepath.Dir(cf)),
			"services":        svcNames,
			"serviceCount":    len(svcNames),
			"parseError":      parseErr,
			"updatedAt":       updated,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i]["name"].(string) < out[j]["name"].(string)
	})
	return out, nil
}

func parseServiceNames(raw string) ([]string, []string) {
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return []string{}, []string{err.Error()}
	}
	svcs, ok := doc["services"].(map[string]any)
	if !ok {
		return []string{}, nil
	}
	names := make([]string, 0, len(svcs))
	for k := range svcs {
		names = append(names, k)
	}
	sort.Strings(names)
	return names, nil
}

func relToRoot(p string) string {
	r, err := filepath.Rel(cfg.ComposeRoot, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(r)
}

func envRelPath(projectDir string) any {
	p := filepath.Join(projectDir, ".env")
	if st, err := os.Lstat(p); err == nil && st.Mode().IsRegular() {
		return relToRoot(p)
	}
	return nil
}

// ---------- .env 解析 ----------

func readEnvFile(projectDir string) EnvFileInfo {
	p := filepath.Join(projectDir, ".env")
	raw, err := readRegularFile(p)
	if err != nil {
		return EnvFileInfo{Exists: false, Variables: []EnvVar{}}
	}
	return EnvFileInfo{
		Exists:    true,
		Raw:       string(raw),
		Variables: parseEnvVars(string(raw)),
	}
}

func parseEnvVars(content string) []EnvVar {
	out := []EnvVar{}
	for _, line := range strings.Split(content, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		t = strings.TrimPrefix(t, "export ")
		idx := strings.Index(t, "=")
		if idx == -1 {
			continue
		}
		key := strings.TrimSpace(t[:idx])
		val := strings.TrimSpace(t[idx+1:])
		if len(val) >= 2 {
			if (val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'') {
				val = val[1 : len(val)-1]
			}
		}
		out = append(out, EnvVar{Key: key, Value: val})
	}
	return out
}

// envMap 把 .env 变量转成 map，便于查值
func envMap(vars []EnvVar) map[string]string {
	m := map[string]string{}
	for _, v := range vars {
		m[v.Key] = v.Value
	}
	return m
}

// ---------- compose 解析 ----------

// refPattern 匹配 ${VAR} 或 ${VAR:-default}
var refPattern = regexp.MustCompile(`^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}$`)

func parseProject(name string) (*ProjectInfo, error) {
	projectDir, err := safeJoin(cfg.ComposeRoot, name)
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
	info := &ProjectInfo{
		Name:        name,
		ComposePath: relToRoot(cf),
		ComposeRaw:  string(raw),
		Compose:     map[string]any{},
		Env:         readEnvFile(filepath.Dir(cf)),
		Services:    []ServiceInfo{},
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		info.ParseError = err.Error()
		return info, nil
	}
	if doc == nil {
		doc = map[string]any{}
	}
	info.Compose = doc

	envVals := envMap(info.Env.Variables)
	svcs, _ := doc["services"].(map[string]any)
	names := make([]string, 0, len(svcs))
	for k := range svcs {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, sn := range names {
		cfgMap, _ := svcs[sn].(map[string]any)
		if cfgMap == nil {
			cfgMap = map[string]any{}
		}
		info.Services = append(info.Services, ServiceInfo{
			Name:        sn,
			Image:       stringOf(cfgMap["image"]),
			EnvFile:     stringList(cfgMap["env_file"]),
			Environment: resolveEnvironment(cfgMap["environment"], envVals),
			Config:      cfgMap,
			Raw:         cfgMap,
		})
	}
	return info, nil
}

// resolveEnvironment 把 compose 中的 environment 转成带引用标记的结构。
// 字面量值原样保留；${VAR} 形式则从 .env 取实际值。
func resolveEnvironment(raw any, envVals map[string]string) []EnvVar {
	out := []EnvVar{}
	switch v := raw.(type) {
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			sv := fmt.Sprintf("%v", v[k])
			out = append(out, buildEnvVar(k, sv, envVals))
		}
	case []any:
		for _, item := range v {
			s := fmt.Sprintf("%v", item)
			if idx := strings.Index(s, "="); idx != -1 {
				out = append(out, buildEnvVar(s[:idx], s[idx+1:], envVals))
			} else {
				out = append(out, buildEnvVar(s, "", envVals))
			}
		}
	}
	return out
}

func buildEnvVar(key, rawVal string, envVals map[string]string) EnvVar {
	ev := EnvVar{Key: key, Raw: rawVal}
	if m := refPattern.FindStringSubmatch(rawVal); m != nil {
		ev.IsRef = true
		ev.RefKey = m[1]
		ev.HasDefault = m[2] != "" || strings.Contains(rawVal, ":-")
		ev.Default = m[2]
		ev.Value = envVals[m[1]]
		if ev.Value == "" {
			ev.Value = m[2]
		}
		return ev
	}
	ev.Value = rawVal
	return ev
}

func stringOf(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func stringList(v any) []string {
	out := []string{}
	switch t := v.(type) {
	case string:
		out = append(out, t)
	case []any:
		for _, i := range t {
			out = append(out, fmt.Sprintf("%v", i))
		}
	}
	return out
}

// ---------- 安全路径 ----------

func safeJoin(root, name string) (string, error) {
	if name == "" || strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return "", fmt.Errorf("非法项目名")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	full := filepath.Join(absRoot, name)
	if filepath.Dir(full) != absRoot || filepath.Base(full) != name || !filepath.IsLocal(name) {
		return "", fmt.Errorf("非法路径")
	}
	if info, err := os.Lstat(full); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("项目路径不是普通目录")
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	return full, nil
}

func readRegularFile(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("不是普通文件：%s", filepath.Base(path))
	}
	return os.ReadFile(path)
}
