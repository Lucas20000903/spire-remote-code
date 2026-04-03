# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Spire** — Claude Code 원격 웹 UI. 폰에서 Claude Code 세션을 실시간으로 모니터링하고 메시지를 보내는 셀프 호스팅 PWA. Claude Code의 Channel MCP 기능을 활용하며, 모든 데이터는 로컬 네트워크 안에서만 동작한다.

## Build & Run

```bash
# Rust 서버 빌드
cargo build --release

# 프론트엔드 빌드
cd web && pnpm install && pnpm build

# Bridge 의존성
cd bridge && npm install

# 개발 서버 (Rust)
STATIC_DIR=web/dist cargo run

# 프론트엔드 dev server (HMR)
cd web && pnpm dev

# 테스트
cargo test                          # 전체
cargo test auth_test                # 단일 테스트 파일
cargo test auth_test::test_name     # 단일 테스트 함수
```

## Architecture

3개의 독립적인 프로세스가 협력하는 구조:

```
📱 Phone ←WebSocket→ Rust Server ←SSE→ Bridge (MCP) ←stdio→ Claude Code
                         ↑
                   JSONL file watcher
                   (~/.claude/**/*.jsonl)
```

### Rust Server (`src/`)
Axum 기반 HTTP/WebSocket 서버. 핵심 모듈:
- `main.rs` — 라우터 정의, JSONL watcher → WsHub 브로드캐스트 루프, Bridge 이벤트 처리
- `state.rs` — `AppState` (DB, BridgeRegistry, WsHub, bridge_senders 등 공유 상태)
- `config.rs` — `AppConfig` (port, db_path, claude_projects_dir 등). preferences.toml → 환경변수 → CLI 플래그 순으로 우선순위
- `cli.rs` — `spire setup`, `spire cc`, `spire rebuild` 등 서브커맨드. macOS LaunchAgent 서비스 관리 포함
- `auth/` — bcrypt 패스워드 + JWT 인증, 미들웨어
- `bridge/` — Bridge 등록/해제 레지스트리, SSE 스트림 엔드포인트, permission 요청/응답
- `ws/` — WebSocket hub (클라이언트 브로드캐스트)
- `jsonl/` — JSONL 트랜스크립트 파서 + 파일시스템 watcher (notify crate)
- `session/` — tmux 세션 관리, 프로젝트 스캐너
- `push/` — Web Push 알림 (VAPID)
- `upload.rs` — 멀티파트 파일 업로드

### Bridge (`bridge/bridge.ts`)
MCP Channel 서버. Claude Code와 stdio로 통신하고, Rust 서버와 SSE로 연결. 폰에서 보낸 메시지를 Claude Code에 주입하고, permission 요청을 중계한다.

### Frontend (`web/`)
React 19 + Vite + TailwindCSS 4 + shadcn/ui PWA.
- `hooks/` — `use-websocket.tsx` (WS 연결), `use-sessions.tsx` (세션 상태), `use-auth.ts`, `use-settings.ts`
- `components/chat/` — 채팅 뷰, 메시지 렌더링, 입력
- `components/layout/` — 사이드바, 앱 레이아웃
- `components/webview/` — dev server 미리보기 패널
- `components/auth/` — 로그인/셋업 폼

## Key Data Flow

1. Bridge가 Rust 서버에 등록 (`POST /api/bridges/register`)
2. Bridge가 SSE로 Rust 서버 구독 (`GET /api/bridges/stream`)
3. 폰에서 WebSocket으로 메시지 전송 → Rust 서버 → SSE → Bridge → Claude Code (Channel notification)
4. Claude Code가 JSONL에 기록 → Rust 서버 file watcher 감지 → WebSocket으로 폰에 브로드캐스트
5. JSONL의 cwd 필드로 Bridge와 세션을 자동 매칭 (`main.rs`의 auto-match 로직)

## Environment Variables

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `STATIC_DIR` | auto-detect `web/dist` | 프론트엔드 빌드 디렉토리 |
| `BRIDGE_PORT_RANGE` | `8800-8899` | Bridge 포트 대역 |
| `RUST_LOG` | `info` | 로그 레벨 |

## Storage

- SQLite DB: `~/.spire/data.db` (유저, JWT 시크릿, 설정, 즐겨찾기)
- Preferences: `~/.spire/preferences.toml` (tmux, port, bridge_path 등)
- 업로드 임시파일: `.temp/`

## Conventions

- Rust 코드의 주석은 한국어
- 프론트엔드는 `@/` alias로 `web/src/` 경로 임포트
- shadcn/ui 컴포넌트는 `web/src/components/ui/`에 위치
- 인증이 필요한 API 라우트는 `require_auth` 미들웨어 적용 (`protected` 라우터)
- Bridge 내부 통신 라우트(`/api/bridges/*`)는 인증 없이 접근 (localhost만)

## Debugging

### 디버그 스크립트 (`scripts/debug/`)

```bash
# 전체 상태 진단 (tmux + Bridge + Hook + API 매칭)
bash scripts/debug/session-debug.sh

# Hook 이벤트 수동 테스트
bash scripts/debug/hook-test.sh Stop my-session-id /path/to/cwd

# 터미널 WebSocket 연결 테스트
bash scripts/debug/terminal-test.sh claude_9F5A1348

# 서버 로그 실시간 모니터
bash scripts/debug/ws-monitor.sh hook

# stale 세션/레코드 정리
bash scripts/debug/cleanup.sh --all
```

### 디버그 API

```bash
# tmux 세션 목록 (command, cwd 포함)
curl http://localhost:$PORT/api/tmux/sessions | python3 -m json.tool

# 매칭 디버그 (descendant PIDs, Bridge PID 매칭 결과)
curl http://localhost:$PORT/api/tmux/debug | python3 -m json.tool

# Hook DB 상태
sqlite3 ~/.spire/data.db "SELECT session_id, tmux_session, cwd, status, updated_at FROM hook_status;"

# Bridge 레지스트리
sqlite3 ~/.spire/data.db "SELECT id, pid, session_id, cwd, status FROM session ORDER BY last_active DESC;"

# 서버 로그
tail -f ~/.spire/stdout.log | grep -E "hook|session|terminal|error"
```

### 세션 매칭 소스 (우선순위)

1. **Hook DB `tmux_session`** — `spire hook`이 `tmux display -p '#{session_name}'`으로 감지, 100% 정확
2. **Active Bridge `session_id`** — MCP 연결 중일 때만 사용 가능
3. **None** — Hook 미등록 + Bridge 미연결 세션은 채팅 불가, 터미널만 제공

### LaunchAgent 환경 주의사항

LaunchAgent(`~/.spire/plist`)에서 실행될 때 환경변수가 부족할 수 있음:
- `HOME` — dirs 크레이트가 홈 디렉토리를 못 찾을 수 있음
- `TMUX_TMPDIR` — tmux 소켓 경로 (`/private/tmp`) 필요
- `PATH` — `/opt/homebrew/bin` 포함 필요
- `TERM` — 터미널 PTY에 `xterm-256color` 필요
- `LANG`/`LC_ALL` — 한글 지원에 `ko_KR.UTF-8` 필요

### 흔한 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| tmux 세션 목록 비어있음 | LaunchAgent에서 `TMUX_TMPDIR` 미설정 | plist에 `TMUX_TMPDIR=/private/tmp` 추가 |
| 같은 cwd 세션이 같은 채팅 보여줌 | Hook의 `tmux_session` 미매핑 | Hook 재등록 후 세션에서 아무 동작 수행 |
| 터미널 "does not support clear" | PTY에 `TERM` 미설정 | `terminal.rs`의 `TERM=xterm-256color` 확인 |
| Bridge 재연결 안 됨 | SSE 끊김 + heartbeat 미작동 | `bridge.ts`의 30초 re-register interval 확인 |
| `spire-mobile-*` 세션 쌓임 | WebSocket 끊길 때 cleanup 실패 | `bash scripts/debug/cleanup.sh` 또는 서버 재시작 시 자동 정리 |

## Session Architecture

### 세션 식별 체계

```
tmux session (source of truth)
  ├─ name: "claude_9F5A1348"
  ├─ cwd: "/Users/lucas/workspace/project"
  └─ pane_pid → process tree → claude process

Claude Code session
  ├─ session_id: "57aee9d4-..."  (JSONL 파일명)
  └─ transcript: ~/.claude/projects/{mangled-cwd}/{session_id}.jsonl

Hook DB (매핑 레이어)
  └─ tmux_session ↔ session_id  (spire hook이 기록)

Bridge (MCP 채널, 선택적)
  └─ bridge_id ↔ session_id  (MCP 연결 시에만)
```

### Hook 기반 세션 상태

```
SessionStart       → "active"       (세션 시작/재개)
UserPromptSubmit   → "in-progress"  (사용자 입력, prompt 저장)
PreToolUse         → "tool-running" (도구 실행 중, tool_name 저장)
Stop               → "idle"         (응답 완료, last_assistant_message 저장)
StopFailure        → "error"        (API 에러, error_type 저장)
SessionEnd         → "disconnected" (세션 종료)
```

### Plugin 구조 (`plugin/`)

```
plugin/
├── .claude-plugin/plugin.json   ← 메타데이터
├── .mcp.json                    ← Bridge MCP 서버 등록
└── hooks/hooks.json             ← 6개 Hook (SessionStart~SessionEnd)
```

Hook은 `~/.claude/settings.json`에도 등록 가능 (현재 방식). 모든 Hook은 `spire hook` 서브커맨드를 호출하며, stdin JSON에 `tmux_session` 필드를 자동 주입한 뒤 서버에 POST.
