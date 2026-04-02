# DX 개선: Dev Workflow + 세션 영속화

**Date:** 2026-04-02
**Scope:** A) `spire dev` 통합 개발 환경 B) 세션 DB 영속화 + Bridge 자동 재연결

---

## 문제

### A: Dev Workflow
현재 개발 루프:
1. Rust 코드 수정 → `cargo build --release` → 바이너리를 `~/.local/bin/`에 복사
2. 프론트엔드 수정 → `pnpm build` → `web/dist`를 `~/.spire/web/`에 복사
3. 서버 재시작 → 브라우저 새로고침
4. 매번 프로덕션 빌드 과정 반복 (release 빌드 느림, HMR 없음)

### B: 세션 영속화
- `BridgeRegistry`가 메모리에만 존재 → 서버 재시작 시 모든 세션 매핑 소실
- Bridge SSE 재연결 시 새 bridge_id 발급 → 기존 session_id 매핑 끊김
- Claude Code에서 `/mcp` 수동 재연결 필요 (Bridge MCP 프로세스 자체는 살아있음에도)

---

## 설계

### A: `spire dev` — 통합 개발 서버

#### 원리
Vite config에 이미 proxy 설정이 존재 (`/api` → `:3001`, `/ws` → `ws://:3001`). 이를 활용하여:
- **Vite dev server** (port 3000): 프론트엔드 HMR
- **Rust server** (port 3001): API + WebSocket, `cargo-watch`로 변경 감지 시 자동 재빌드+재시작

#### 구현

**1. `spire dev` 서브커맨드 추가 (`src/cli.rs`)**

```
spire dev
```

이 명령은 두 프로세스를 동시에 실행:
- `cargo watch -x 'run -- -p 3001'` — Rust 서버 (debug 빌드, port 3001)
- `cd web && pnpm dev` — Vite dev server (port 3000, proxy 활성)

`spire dev`는 두 자식 프로세스를 spawn하고, 하나라도 종료되면 다른 것도 kill. Ctrl+C로 둘 다 종료.

**2. 전제 조건**
- `cargo-watch` 설치 필요: `cargo install cargo-watch`
- `spire dev` 최초 실행 시 `cargo-watch` 없으면 설치 안내 메시지 출력

**3. STATIC_DIR 비활성화**
port 3001로 실행할 때 `STATIC_DIR`을 설정하지 않음 → Rust 서버는 API/WS만 담당, 프론트는 Vite가 서빙.

**4. 개발 흐름 (변경 후)**
- Rust 수정 → cargo-watch가 자동 재빌드(debug) + 재시작 (~3초)
- 프론트 수정 → Vite HMR (~100ms)
- `http://localhost:3000` 하나만 열면 됨

---

### B: 세션 DB 영속화 + Bridge 자동 재연결

#### 핵심 인사이트
Bridge 프로세스는 Claude Code가 시작한 MCP 서버이므로, **Rust 서버가 재시작되어도 Bridge 프로세스는 살아있다**. Bridge의 `connectSSE` 루프가 이미 자동 재연결 + 재등록을 수행한다 (bridge.ts:74-111). 문제는 서버가 세션 매핑을 잃어버린다는 것뿐이다.

#### DB 스키마 변경 (`src/db.rs`)

```sql
CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,            -- bridge_id (br-xxx)
    session_id TEXT,                -- Claude Code session UUID
    cwd TEXT NOT NULL,
    pid INTEGER NOT NULL,
    port INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',  -- active | disconnected
    last_active TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_cwd ON session(cwd);
CREATE INDEX IF NOT EXISTS idx_session_pid ON session(pid);
```

#### BridgeRegistry 변경 (`src/bridge/registry.rs`)

현재 `BridgeRegistry`는 순수 메모리 구조체. DB 연동을 추가:

1. **`register()` 변경:**
   - 기존: pid 매칭으로 bridge_id 재사용 (메모리만)
   - 변경: pid 매칭 실패 시 → **DB에서 같은 cwd + pid로 검색** → 기존 bridge_id 및 session_id 복원
   - DB에 upsert (bridge_id, session_id, cwd, pid, port, status='active')

2. **`update_session()` 변경:**
   - 기존: 메모리만 업데이트
   - 변경: DB에도 session_id 업데이트

3. **`unregister()` 변경:**
   - 기존: 메모리에서 제거
   - 변경: DB에서 status='disconnected'으로 업데이트 (삭제하지 않음)

4. **서버 시작 시:**
   - DB에서 모든 session을 로드하지 않음 (죽은 세션 관심 없으므로)
   - 대신, Bridge가 재연결할 때 DB 조회로 기존 매핑 복원

#### Bridge 재연결 시나리오 (변경 후)

```
1. 서버 재시작
2. Bridge SSE 끊김 → connectSSE 루프가 재시도
3. Bridge가 register(port, cwd, pid) 호출
4. 서버: 메모리에 pid 매칭 없음 → DB에서 cwd+pid로 검색
5. DB에서 기존 bridge_id + session_id 발견
6. 같은 bridge_id 반환 + session_id 자동 복원
7. Bridge는 기존 bridge_id로 SSE 연결 → 정상 동작
8. 프론트엔드에 session_registered 이벤트 발송 → UI 자동 복원
```

**결과: Claude Code에서 `/mcp` 재연결 불필요.**

#### BridgeRegistry에 DbPool 주입

`BridgeRegistry::new()`가 `DbPool`을 받도록 변경:

```rust
impl BridgeRegistry {
    pub fn new(db: DbPool) -> Arc<Self> { ... }
}
```

register/update_session/unregister 내부에서 DB 읽기/쓰기 수행.

---

## 변경 파일 목록

### A: Dev Workflow
| 파일 | 변경 |
|------|------|
| `src/main.rs` | `Commands::Dev` 서브커맨드 추가 |
| `src/cli.rs` | `spire dev` 구현 (cargo-watch + pnpm dev 동시 실행) |

### B: 세션 영속화
| 파일 | 변경 |
|------|------|
| `src/db.rs` | `session` 테이블 생성 마이그레이션 |
| `src/bridge/registry.rs` | DB 연동 (register/update/unregister에 DB 읽기/쓰기) |
| `src/main.rs` | `BridgeRegistry::new(db)` 호출로 변경 |

---

## 변경하지 않는 것

- `bridge/bridge.ts` — 변경 불필요. 기존 재연결 로직이 그대로 동작
- `web/` — 변경 불필요. 프론트엔드는 이미 session_registered 이벤트를 처리
- `vite.config.ts` — 변경 불필요. proxy 설정이 이미 올바름
- 죽은 세션 목록/히스토리 — scope 밖

---

## 테스트 계획

### A: Dev Workflow
- [ ] `spire dev` 실행 → Vite(3000) + Rust(3001) 동시 기동 확인
- [ ] Rust 코드 수정 → 자동 재빌드+재시작 확인
- [ ] 프론트엔드 수정 → HMR 동작 확인
- [ ] Ctrl+C → 두 프로세스 모두 종료 확인

### B: 세션 영속화
- [ ] Bridge 등록 → DB에 session 레코드 생성 확인
- [ ] session_id 업데이트 → DB 반영 확인
- [ ] 서버 재시작 → Bridge 재연결 → 기존 bridge_id + session_id 복원 확인
- [ ] 프론트엔드에서 세션이 자동 복원되는지 확인
- [ ] `cargo test` — registry 유닛 테스트에 DB 연동 테스트 추가
