package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveNestedProject(t *testing.T) {
	previous := cfg
	t.Cleanup(func() { cfg = previous })
	cfg.ComposeRoot = t.TempDir()
	projectDir := filepath.Join(cfg.ComposeRoot, "example", "nested")
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatal(err)
	}
	composePath := filepath.Join(projectDir, "compose.yml")
	envPath := filepath.Join(projectDir, ".env")
	original := "# keep comment\nservices:\n  web:\n    image: nginx\n    environment:\n      API_TOKEN: ${SHARED_TOKEN}\n"
	if err := os.WriteFile(composePath, []byte(original), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(envPath, []byte("SHARED_TOKEN=before\n"), 0600); err != nil {
		t.Fatal(err)
	}
	project, err := parseProject("example")
	if err != nil {
		t.Fatal(err)
	}
	if e := project.Services[0].Environment[0]; e.RefKey != "SHARED_TOKEN" || e.Value != "before" {
		t.Fatalf("引用未正确解析: %+v", e)
	}
	if _, err := saveComposeConfig("example", original, []EnvVar{{Key: "SHARED_TOKEN", Value: "after"}}); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(envPath); err != nil || string(data) != "SHARED_TOKEN=after\n" {
		t.Fatalf(".env 未正确更新: %s %v", data, err)
	}
	if _, err := saveComposeConfig("example", strings.ReplaceAll(original, "nginx", "alpine"), []EnvVar{{Key: "BAD=KEY", Value: "oops"}}); err == nil {
		t.Fatal("应拒绝无效变量名")
	}
	if data, err := os.ReadFile(composePath); err != nil || string(data) != original {
		t.Fatalf("Compose 不应被改动: %s %v", data, err)
	}
	if _, err := saveComposeConfig("example", "# empty", nil); err == nil {
		t.Fatal("应拒绝没有服务的 YAML")
	}
	if err := saveEnvRaw("example", "# exact\nSHARED_TOKEN='a $literal'\n"); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(envPath); err != nil || string(data) != "# exact\nSHARED_TOKEN='a $literal'\n" {
		t.Fatalf("原文未正确保存: %s %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(cfg.ComposeRoot, "example", ".env")); !os.IsNotExist(err) {
		t.Fatalf("不应在外层创建 .env: %v", err)
	}

	if err := checkProjectActionName("example", composePath); err != nil {
		t.Fatal(err)
	}
	if err := saveEnvRaw("example", "COMPOSE_PROJECT_NAME=another\n"); err != nil {
		t.Fatal(err)
	}
	if err := checkProjectActionName("example", composePath); err == nil {
		t.Fatal("应拒绝不匹配的 Compose 项目名")
	}
}

func TestSaveEnvRawRequiresContent(t *testing.T) {
	req := httptest.NewRequest(http.MethodPut, "/api/project/test/env/raw", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	handleSaveEnvRaw(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got status %d", rec.Code)
	}
}

func TestValidAppPassword(t *testing.T) {
	for _, s := range []string{"", " ", "admin123", "ChangeMe"} {
		if validAppPassword(s) {
			t.Errorf("不应接受空密码或示例密码")
		}
	}
	if !validAppPassword("sample-only-strong-password-92") {
		t.Fatal("应接受自定义密码")
	}
}

func TestParseDockerAPIPrefix(t *testing.T) {
	for _, value := range []string{"1.41", "1.44", "1.53"} {
		if got, err := parseDockerAPIPrefix([]byte(`{"ApiVersion":"` + value + `"}`)); err != nil || got != "/v"+value {
			t.Fatalf("API %s: got %q, %v", value, got, err)
		}
	}
	if _, err := parseDockerAPIPrefix([]byte(`{}`)); err == nil {
		t.Fatal("missing version must be rejected")
	}
}
