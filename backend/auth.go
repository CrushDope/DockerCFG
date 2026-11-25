package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

type sessionStore struct {
	mu     sync.RWMutex
	tokens map[string]time.Time
}

var sessions = &sessionStore{tokens: map[string]time.Time{}}

// sessionTTLSeconds 会话有效期（秒）
const sessionTTLSeconds = 7 * 24 * 3600

// sessionTTL 同一有效期的 Duration 形式，用于过期判断
const sessionTTL = time.Duration(sessionTTLSeconds) * time.Second

func (s *sessionStore) Valid(token string) bool {
	if token == "" {
		return false
	}
	s.mu.RLock()
	t, ok := s.tokens[token]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	if time.Since(t) > sessionTTL {
		s.Delete(token)
		return false
	}
	return true
}

func (s *sessionStore) Add(token string) {
	s.mu.Lock()
	s.tokens[token] = time.Now()
	s.mu.Unlock()
}

func (s *sessionStore) Delete(token string) {
	s.mu.Lock()
	delete(s.tokens, token)
	s.mu.Unlock()
}

func jsonEncode(w http.ResponseWriter, v any) error {
	return json.NewEncoder(w).Encode(v)
}

// ---------- 处理器 ----------

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("dcm_token")
	authed := err == nil && sessions.Valid(c.Value)
	writeJSON(w, http.StatusOK, map[string]bool{"authenticated": authed})
}

func validAppPassword(password string) bool {
	switch strings.ToLower(strings.TrimSpace(password)) {
	case "", "admin123", "changeme":
		return false
	default:
		return true
	}
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}
	provided, expected := sha256.Sum256([]byte(body.Password)), sha256.Sum256([]byte(cfg.Password))
	if subtle.ConstantTimeCompare(provided[:], expected[:]) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "密码错误"})
		return
	}
	token := randomToken()
	if token == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "无法创建会话"})
		return
	}
	sessions.Add(token)
	http.SetCookie(w, &http.Cookie{
		Name:     "dcm_token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   sessionTTLSeconds,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("dcm_token"); err == nil {
		sessions.Delete(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "dcm_token", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
