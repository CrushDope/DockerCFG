package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	Port         int
	Host         string
	ComposeRoot  string
	DockerSocket string
	StaticDir    string
	Password     string
}

var cfg Config

func main() {
	cfg = Config{
		Port:         envInt("PORT", 3001),
		Host:         env("HOST", "0.0.0.0"),
		ComposeRoot:  env("COMPOSE_ROOT", "/compose"),
		DockerSocket: env("DOCKER_SOCKET", "/var/run/docker.sock"),
		StaticDir:    env("STATIC_DIR", "/app/web"),
		Password:     os.Getenv("APP_PASSWORD"),
	}

	if !validAppPassword(cfg.Password) {
		log.Fatal("请设置 APP_PASSWORD，不能使用空密码或示例密码")
	}

	mux := http.NewServeMux()

	// ---- 鉴权 ----
	mux.HandleFunc("GET /api/auth/status", handleAuthStatus)
	mux.HandleFunc("POST /api/auth/login", handleLogin)
	mux.HandleFunc("POST /api/auth/logout", handleLogout)

	// ---- 受保护接口 ----
	// 注意：ServeMux 不会剥离前缀，子 mux 收到的仍是完整路径，所以这里注册完整路径
	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/overview", handleOverview)
	protected.HandleFunc("GET /api/project/{name}", handleGetProject)
	protected.HandleFunc("POST /api/project", handleCreateProject)
	protected.HandleFunc("PUT /api/project/{name}/compose", handleSaveCompose)
	protected.HandleFunc("PUT /api/project/{name}/env", handleSaveEnv)
	protected.HandleFunc("PUT /api/project/{name}/env/raw", handleSaveEnvRaw)
	protected.HandleFunc("POST /api/project/{name}/action", handleProjectAction)
	protected.HandleFunc("POST /api/container/{id}/action", handleContainerAction)
	protected.HandleFunc("GET /api/docker/status", handleDockerStatus)
	mux.Handle("/api/", requireAuth(protected))

	// ---- 静态资源 ----
	// 注意：不能写成 "GET /"，Go 1.22+ 的 ServeMux 会判定它与 "/api/" 冲突
	mux.HandleFunc("/", handleStatic)

	srv := &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Handler:      logging(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
	}

	log.Printf("DockerCFG Manager 启动: http://%s:%d", cfg.Host, cfg.Port)
	log.Printf("Compose 根目录: %s", cfg.ComposeRoot)
	log.Printf("Docker Socket: %s", cfg.DockerSocket)
	log.Printf("静态资源目录: %s", cfg.StaticDir)

	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return def
}

// ---------- 静态资源 ----------

func handleStatic(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if strings.HasPrefix(p, "/api/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "接口不存在"})
		return
	}
	if p == "/" {
		p = "/index.html"
	}
	full := filepath.Join(cfg.StaticDir, filepath.Clean("/"+p))
	if st, err := os.Stat(full); err == nil && !st.IsDir() {
		http.ServeFile(w, r, full)
		return
	}
	// SPA 回退
	idx := filepath.Join(cfg.StaticDir, "index.html")
	if _, err := os.Stat(idx); err == nil {
		http.ServeFile(w, r, idx)
		return
	}
	http.Error(w, "前端未构建", http.StatusNotFound)
}

// ---------- 中间件 ----------

func requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("dcm_token")
		if err != nil || !sessions.Valid(c.Value) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录或会话已过期"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := jsonEncode(w, v); err != nil {
		log.Printf("JSON 编码失败: %v", err)
	}
}

// ---------- 工具 ----------

func randomToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}
