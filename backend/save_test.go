package main

import "testing"

func TestMergeEnvContent(t *testing.T) {
	cases := []struct {
		name     string
		original string
		vars     []EnvVar
		want     string
	}{
		{
			name:     "更新已有变量",
			original: "TMDB_API_KEY=your_tmdb_key_here\nTZ=Asia/Shanghai\n",
			vars:     []EnvVar{{Key: "TMDB_API_KEY", Value: "NEW_KEY_FROM_ENV"}},
			want:     "TMDB_API_KEY=NEW_KEY_FROM_ENV\nTZ=Asia/Shanghai\n",
		},
		{
			name:     "保留注释与空行",
			original: "# 注释行\nTMDB_API_KEY=old\n\nTZ=Asia/Shanghai\n",
			vars:     []EnvVar{{Key: "TMDB_API_KEY", Value: "new"}},
			want:     "# 注释行\nTMDB_API_KEY=new\n\nTZ=Asia/Shanghai\n",
		},
		{
			name:     "追加新变量",
			original: "TZ=Asia/Shanghai\n",
			vars:     []EnvVar{{Key: "NEW_ONE", Value: "v1"}},
			want:     "TZ=Asia/Shanghai\nNEW_ONE=v1\n",
		},
		{
			name:     "原文件无结尾换行",
			original: "TZ=Asia/Shanghai",
			vars:     []EnvVar{{Key: "TZ", Value: "Asia/Tokyo"}},
			want:     "TZ=Asia/Tokyo",
		},
		{
			name:     "去重：原文件重复键",
			original: "A=1\nA=2\nB=3\n",
			vars:     []EnvVar{{Key: "A", Value: "9"}},
			want:     "A=9\nB=3\n",
		},
		{
			name:     "空文件",
			original: "",
			vars:     []EnvVar{{Key: "A", Value: "1"}},
			want:     "A=1\n",
		},
		{
			name:     "带引号的值",
			original: "MSG=\"hello world\"\n",
			vars:     []EnvVar{{Key: "MSG", Value: "new msg"}},
			want:     "MSG=new msg\n",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := mergeEnvContent(c.original, c.vars)
			if got != c.want {
				t.Errorf("不匹配\n期望: %q\n得到: %q", c.want, got)
			}
		})
	}
}

func TestParseEnvVars(t *testing.T) {
	vars := parseEnvVars("# comment\nexport FOO=bar\nQUOTED=\"a b\"\nEMPTY=\n")
	if len(vars) != 3 {
		t.Fatalf("期望 3 个变量，得到 %d: %+v", len(vars), vars)
	}
	if vars[0].Key != "FOO" || vars[0].Value != "bar" {
		t.Errorf("export 前缀处理错误: %+v", vars[0])
	}
	if vars[1].Key != "QUOTED" || vars[1].Value != "a b" {
		t.Errorf("引号剥离错误: %+v", vars[1])
	}
	if vars[2].Key != "EMPTY" || vars[2].Value != "" {
		t.Errorf("空值处理错误: %+v", vars[2])
	}
}

func TestResolveEnvironment(t *testing.T) {
	envVals := map[string]string{"TMDB_API_KEY": "real_key", "TZ": "Asia/Shanghai"}
	raw := map[string]any{
		"REF":     "${TMDB_API_KEY}",
		"LITERAL": "hardcoded",
		"DEFAULT": "${MISSING:-fallback}",
	}
	got := resolveEnvironment(raw, envVals)
	if len(got) != 3 {
		t.Fatalf("期望 3 项，得到 %d", len(got))
	}
	byKey := map[string]EnvVar{}
	for _, e := range got {
		byKey[e.Key] = e
	}
	if !byKey["REF"].IsRef || byKey["REF"].Value != "real_key" {
		t.Errorf("引用变量解析错误: %+v", byKey["REF"])
	}
	if byKey["LITERAL"].IsRef || byKey["LITERAL"].Value != "hardcoded" {
		t.Errorf("字面量解析错误: %+v", byKey["LITERAL"])
	}
	if !byKey["DEFAULT"].IsRef || byKey["DEFAULT"].Value != "fallback" {
		t.Errorf("默认值解析错误: %+v", byKey["DEFAULT"])
	}
}

func TestSafeJoin(t *testing.T) {
	if _, err := safeJoin("/tmp/root", "../evil"); err == nil {
		t.Error("路径穿越应被拒绝")
	}
	if _, err := safeJoin("/tmp/root", "a/b"); err == nil {
		t.Error("含斜杠的项目名应被拒绝")
	}
	if _, err := safeJoin("/tmp/root", "ok-name"); err != nil {
		t.Errorf("合法项目名不应报错: %v", err)
	}
}
