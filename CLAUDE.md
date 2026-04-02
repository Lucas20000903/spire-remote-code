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
