<p align="center">
  <img src="./logo-light.svg#gh-light-mode-only" height="48" alt="Spire" />
  <img src="./logo-dark.svg#gh-dark-mode-only" height="48" alt="Spire" />
</p>

<p align="center">
  <strong>Remote web UI for Claude Code</strong><br/>
  Control Claude Code sessions from your phone
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#features">Features</a> ·
  <a href="#한국어">한국어</a>
</p>

---

## Features

- **Real-time chat** — Watch Claude Code work in real-time from your phone
- **Multi-session** — Manage multiple Claude Code sessions across different projects
- **File upload** — Send images and files to Claude Code via the web UI
- **PWA** — Install as a native app on iOS/Android (Home Screen)
- **Notifications** — Browser notifications when tasks complete
- **Dark mode** — Follows system preference

## Installation

### Option 1: npm / pnpm

```bash
npm install -g spire-remote-code
# or
pnpm add -g spire-remote-code
```

### Option 2: curl

```bash
curl -fsSL https://raw.githubusercontent.com/Lucas20000903/spire-remote-code/main/install.sh | sh
```

### Option 3: Build from source

## Quick Start

### 1. Build

```bash
# Rust server
cargo build --release

# Frontend
cd web && pnpm install && pnpm build && cd ..

# Bridge
cd bridge && bun install && cd ..
```

### 2. Run

```bash
STATIC_DIR=web/dist ./target/release/spire
```

Server starts at `http://0.0.0.0:3000`.

### 3. Register Bridge MCP Server

Register the Bridge as a global MCP server in Claude Code:

```bash
claude mcp add -s user spire bun /path/to/spire/bridge/bridge.ts
```

### 4. Claude Code Launch Config

The `--dangerously-load-development-channels` flag is required to activate the Bridge. Wrap it in a shell function:

```bash
# ~/.zshrc or ~/.bashrc
claude() {
  if [ -z "$TMUX" ]; then
    local session_name="claude_$(uuidgen | cut -c1-8)"
    tmux new-session -s "$session_name" "command claude --dangerously-load-development-channels server:spire $*"
  else
    command claude --dangerously-load-development-channels server:spire "$@"
  fi
}
```

Or a simple alias:

```bash
alias claude='claude --dangerously-load-development-channels server:spire'
```

### 5. Connect from Phone

1. Open `http://<mac-ip>:3000`
2. Create account on first visit
3. Log in and see active sessions
4. Install as PWA (browser menu → "Add to Home Screen")

## Architecture

```mermaid
graph TB
  subgraph Mac
    subgraph Rust["Rust Server :3000"]
      Auth["Auth<br/>(SQLite)"]
      Registry["Session<br/>Registry"]
      Watcher["JSONL<br/>Watcher"]
      WS["WebSocket<br/>Hub"]
      Router["Bridge<br/>Router"]
      Upload["File<br/>Upload"]
    end

    Bridge0["Bridge :8800"]
    Bridge1["Bridge :8801"]
    Bridge2["Bridge :8802"]

    CC0["Claude Code (0)"]
    CC1["Claude Code (1)"]
    CC2["Claude Code (2)"]

    Router -- "HTTP/SSE" --> Bridge0
    Router -- "HTTP/SSE" --> Bridge1
    Router -- "HTTP/SSE" --> Bridge2

    Bridge0 -- "stdio" --> CC0
    Bridge1 -- "stdio" --> CC1
    Bridge2 -- "stdio" --> CC2

    CC0 -. "writes jsonl" .-> Watcher
    CC1 -. "writes jsonl" .-> Watcher
    CC2 -. "writes jsonl" .-> Watcher
  end

  Phone["📱 Phone (PWA)<br/>React + Vite"]
  Phone -- "WebSocket" --> WS
  Watcher -- "jsonl_update" --> WS
```

### Data Flow

```mermaid
sequenceDiagram
    participant P as Phone
    participant R as Rust Server
    participant B as Bridge
    participant C as Claude Code
    participant J as JSONL File

    P->>R: send_message (WebSocket)
    R->>B: forward (SSE)
    B->>C: MCP notification
    C->>J: write response
    J-->>R: file change detected
    R-->>P: jsonl_update (WebSocket)
```

## Tech Stack

```mermaid
graph LR
    subgraph Backend
        Rust["🦀 Rust<br/>Axum, Tokio"]
        SQLite["🗄️ SQLite"]
    end
    subgraph Bridge
        Bun["🥟 Bun<br/>TypeScript, MCP SDK"]
    end
    subgraph Frontend
        React["⚛️ React 19"]
        Vite["⚡ Vite"]
        Tailwind["🎨 Tailwind CSS 4"]
        Motion["🎬 Framer Motion"]
    end

    React --> Vite
    React --> Tailwind
    React --> Motion
    Rust --> SQLite
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `STATIC_DIR` | (none) | Frontend build directory |
| `BRIDGE_PORT_RANGE` | `8800-8899` | Bridge port range |

## CLI

```bash
# Run server
spire

# Reset auth (forgot password)
spire reset-auth
```

## Project Structure

```
spire/
├── src/                     # Rust backend
│   ├── main.rs              # Server entry, router
│   ├── auth/                # JWT authentication
│   ├── bridge/              # Bridge registry, SSE
│   ├── ws/                  # WebSocket hub
│   ├── jsonl/               # JSONL parser + file watcher
│   ├── session/             # Tmux + project scanner
│   ├── upload.rs            # File upload endpoint
│   └── push/                # Web Push notifications
├── bridge/
│   └── bridge.ts            # MCP channel server
├── web/
│   └── src/
│       ├── components/
│       │   ├── chat/        # Chat view, messages, input
│       │   ├── layout/      # App layout, sidebar
│       │   ├── settings/    # Settings dialog
│       │   └── auth/        # Login/setup forms
│       ├── hooks/           # useWebSocket, useSessions, useSettings
│       └── lib/             # Types, API, notifications
├── tests/                   # Rust integration tests
└── Cargo.toml
```

## Testing

```bash
cargo test
```

## License

MIT

---

<a id="한국어"></a>

## 한국어

<p align="center">
  <img src="./logo-light.svg#gh-light-mode-only" height="48" alt="Spire" />
  <img src="./logo-dark.svg#gh-dark-mode-only" height="48" alt="Spire" />
</p>

<p align="center">
  <strong>Claude Code 원격 웹 UI</strong><br/>
  폰에서 Claude Code 세션을 원격 조작하는 웹앱
</p>

### 주요 기능

- **실시간 채팅** — Claude Code의 작업을 실시간으로 폰에서 확인
- **멀티 세션** — 여러 프로젝트의 Claude Code 세션을 동시에 관리
- **파일 업로드** — 이미지와 파일을 웹 UI에서 Claude Code로 전송
- **PWA** — iOS/Android에서 네이티브 앱처럼 설치 (홈 화면에 추가)
- **알림** — 작업 완료 시 브라우저 알림
- **다크 모드** — 시스템 설정 자동 감지

### 설치

#### 방법 1: npm / pnpm

```bash
npm install -g spire-remote-code
# 또는
pnpm add -g spire-remote-code
```

#### 방법 2: curl

```bash
curl -fsSL https://raw.githubusercontent.com/Lucas20000903/spire-remote-code/main/install.sh | sh
```

#### 방법 3: 소스에서 빌드

### 빠른 시작

#### 1. 빌드

```bash
# Rust 서버
cargo build --release

# 프론트엔드
cd web && pnpm install && pnpm build && cd ..

# Bridge
cd bridge && bun install && cd ..
```

#### 2. 실행

```bash
STATIC_DIR=web/dist ./target/release/spire
```

서버가 `http://0.0.0.0:3000`에서 시작됩니다.

#### 3. Bridge MCP 서버 등록

Claude Code에 Bridge를 글로벌 MCP 서버로 등록합니다:

```bash
claude mcp add -s user spire bun /path/to/spire/bridge/bridge.ts
```

#### 4. Claude Code 실행 설정

등록된 Bridge를 활성화하려면 `--dangerously-load-development-channels` 플래그가 필요합니다. 셸 함수로 감싸면 편합니다:

```bash
# ~/.zshrc 또는 ~/.bashrc
claude() {
  if [ -z "$TMUX" ]; then
    local session_name="claude_$(uuidgen | cut -c1-8)"
    tmux new-session -s "$session_name" "command claude --dangerously-load-development-channels server:spire $*"
  else
    command claude --dangerously-load-development-channels server:spire "$@"
  fi
}
```

또는 단순 alias:

```bash
alias claude='claude --dangerously-load-development-channels server:spire'
```

#### 5. 폰에서 접속

1. `http://<mac-ip>:3000` 접속
2. 최초 접속 시 계정 생성
3. 로그인 후 활성 세션 목록 확인
4. PWA로 설치 (브라우저 메뉴 → "홈 화면에 추가")

### 아키텍처

```mermaid
graph TB
  subgraph Mac
    subgraph Rust["Rust 서버 :3000"]
      Auth["인증<br/>(SQLite)"]
      Registry["세션<br/>레지스트리"]
      Watcher["JSONL<br/>워처"]
      WS["WebSocket<br/>허브"]
      Router["브릿지<br/>라우터"]
      Upload["파일<br/>업로드"]
    end

    Bridge0["브릿지 :8800"]
    Bridge1["브릿지 :8801"]

    CC0["Claude Code (0)"]
    CC1["Claude Code (1)"]

    Router -- "HTTP/SSE" --> Bridge0
    Router -- "HTTP/SSE" --> Bridge1

    Bridge0 -- "stdio" --> CC0
    Bridge1 -- "stdio" --> CC1

    CC0 -. "jsonl 기록" .-> Watcher
    CC1 -. "jsonl 기록" .-> Watcher
  end

  Phone["📱 폰 (PWA)<br/>React + Vite"]
  Phone -- "WebSocket" --> WS
  Watcher -- "jsonl_update" --> WS
```

### 데이터 흐름

```mermaid
sequenceDiagram
    participant P as 폰
    participant R as Rust 서버
    participant B as 브릿지
    participant C as Claude Code
    participant J as JSONL 파일

    P->>R: 메시지 전송 (WebSocket)
    R->>B: 전달 (SSE)
    B->>C: MCP 알림
    C->>J: 응답 기록
    J-->>R: 파일 변경 감지
    R-->>P: jsonl_update (WebSocket)
```

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `STATIC_DIR` | (없음) | 프론트엔드 빌드 디렉토리 경로 |
| `BRIDGE_PORT_RANGE` | `8800-8899` | Bridge 포트 대역 |

### 테스트

```bash
cargo test
```

### 라이선스

MIT
