# Chat Input Redesign + File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅 입력창을 ChatGPT 스타일 pill 컨테이너로 리디자인하고, 이미지/파일 업로드 기능을 Rust 백엔드 + React 프론트엔드에 걸쳐 구현한다.

**Architecture:** Rust 서버에 `POST /upload` multipart 엔드포인트를 추가하여 파일을 `.temp/` 디렉토리에 저장하고 절대 경로를 반환한다. 프론트엔드에서 파일 첨부 시 업로드 후 `[file:/path]` 형식으로 메시지 content에 인라인 포함하여 전송한다.

**Tech Stack:** Rust (axum 0.8 + axum-extra multipart), React 19, TypeScript, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-04-02-chat-input-redesign.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/upload.rs` | multipart 파일 수신, UUID 접두사로 `.temp/`에 저장, 절대 경로 반환 |
| Modify | `src/main.rs:1` | `mod upload;` 추가 |
| Modify | `src/lib.rs` | `pub mod upload;` 추가 (통합 테스트 import용) |
| Modify | `src/main.rs:212-231` | protected router에 `/api/upload` 라우트 추가 |
| Modify | `src/main.rs:83-100` | main()에서 `.temp/` 디렉토리 생성 |
| Modify | `src/error.rs` | `PayloadTooLarge` variant 추가 |
| Modify | `Cargo.toml:7` | axum features에 `"multipart"` 추가 |
| Rewrite | `web/src/components/chat/chat-input.tsx` | ChatGPT 스타일 pill 입력창 + 파일 첨부 UI |
| Create | `tests/upload_test.rs` | upload endpoint 통합 테스트 |

---

## Task 1: Rust — axum multipart 의존성 추가

**Files:**
- Modify: `Cargo.toml:7`

- [ ] **Step 1: Cargo.toml에 multipart feature 추가**

`Cargo.toml` line 7을 변경:
```toml
axum = { version = "0.8", features = ["ws", "multipart"] }
```

- [ ] **Step 2: 빌드 확인**

Run: `cargo check`
Expected: 성공 (no errors)

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml
git commit -m "chore: add axum multipart feature for file upload"
```

---

## Task 2: Rust — PayloadTooLarge 에러 variant 추가

**Files:**
- Modify: `src/error.rs`

- [ ] **Step 1: PayloadTooLarge variant 추가**

`src/error.rs`에 variant와 status code 매핑 추가:

```rust
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Payload too large")]
    PayloadTooLarge,
    #[error("Internal: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = serde_json::json!({ "error": self.to_string() });
        (status, axum::Json(body)).into_response()
    }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cargo check`
Expected: 성공

- [ ] **Step 3: Commit**

```bash
git add src/error.rs
git commit -m "feat: add PayloadTooLarge error variant"
```

---

## Task 3: Rust — upload 모듈 구현

**Files:**
- Create: `src/upload.rs`
- Modify: `src/main.rs:1` (mod 선언 추가)

- [ ] **Step 1: upload.rs 작성**

`src/upload.rs` — multipart 파일 수신, 파일명 sanitize, UUID 접두사, 50MB 제한:

```rust
use axum::extract::Multipart;
use axum::Json;
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::error::AppError;

const MAX_FILE_SIZE: usize = 50 * 1024 * 1024; // 50MB

fn temp_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".temp")
}

/// Sanitize filename: strip path components, replace problematic chars
pub fn sanitize_filename(name: &str) -> String {
    let name = std::path::Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    name.replace(['/', '\\', '\0'], "_")
}

pub fn ensure_temp_dir() {
    let dir = temp_dir();
    if !dir.exists() {
        std::fs::create_dir_all(&dir).expect("failed to create .temp directory");
    }
}

pub async fn handle_upload(mut multipart: Multipart) -> Result<Json<Value>, AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let original_name = field
            .file_name()
            .unwrap_or("file")
            .to_string();
        let sanitized = sanitize_filename(&original_name);

        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        if data.len() > MAX_FILE_SIZE {
            return Err(AppError::PayloadTooLarge);
        }

        let uuid = uuid::Uuid::new_v4();
        let filename = format!("{}-{}", uuid, sanitized);
        let path = temp_dir().join(&filename);

        tokio::fs::write(&path, &data)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;

        let abs_path = path
            .canonicalize()
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        return Ok(Json(json!({
            "path": abs_path,
            "name": original_name,
        })));
    }

    Err(AppError::BadRequest("No file provided".into()))
}
```

- [ ] **Step 2: main.rs에 mod upload 추가**

`src/main.rs` line 1 영역에 추가:
```rust
mod upload;
```

- [ ] **Step 3: lib.rs에 pub mod upload 추가**

`src/lib.rs`에 추가 (통합 테스트에서 `claude_code_remote::upload::*` import용):
```rust
pub mod upload;
```

- [ ] **Step 4: 빌드 확인**

Run: `cargo check`
Expected: 성공 (upload 모듈이 아직 라우터에 연결되지 않았지만 컴파일은 됨)

- [ ] **Step 5: Commit**

```bash
git add src/upload.rs src/main.rs src/lib.rs
git commit -m "feat: add upload module for multipart file handling"
```

---

## Task 4: Rust — 라우터 연결 및 .temp 디렉토리 생성

**Files:**
- Modify: `src/main.rs:83-100` (main 함수 초기화 부분)
- Modify: `src/main.rs:212-231` (protected router)

- [ ] **Step 1: main() 함수에서 .temp 디렉토리 생성 추가**

`src/main.rs` main() 함수 내, `let state = AppState { ... }` 직전에:
```rust
upload::ensure_temp_dir();
```

- [ ] **Step 2: protected router에 upload 라우트 추가**

`src/main.rs`의 `let protected = Router::new()` 체인에 추가:
```rust
.route("/api/upload", post(upload::handle_upload))
```

기존 protected routes (push, projects) 아래에 추가하면 됨. `require_auth` 레이어가 자동 적용됨.

- [ ] **Step 3: 빌드 확인**

Run: `cargo check`
Expected: 성공

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat: wire upload endpoint into protected router"
```

---

## Task 5: Rust — upload 통합 테스트

**Files:**
- Create: `tests/upload_test.rs`

- [ ] **Step 1: 통합 테스트 작성**

`tests/upload_test.rs`:
```rust
use claude_code_remote::upload::{ensure_temp_dir, sanitize_filename};
use std::path::Path;

#[test]
fn test_sanitize_filename_strips_path() {
    assert_eq!(sanitize_filename("../../../etc/passwd"), "passwd");
    assert_eq!(sanitize_filename("foo/bar/baz.txt"), "baz.txt");
    assert_eq!(sanitize_filename("normal.png"), "normal.png");
}

#[test]
fn test_sanitize_filename_replaces_null() {
    assert_eq!(sanitize_filename("file\0name.txt"), "file_name.txt");
}

#[test]
fn test_ensure_temp_dir_creates_directory() {
    ensure_temp_dir();
    assert!(Path::new(".temp").exists());
}
```

- [ ] **Step 2: 테스트 실행**

Run: `cargo test --test upload_test`
Expected: 3 tests passed

- [ ] **Step 3: Commit**

```bash
git add tests/upload_test.rs
git commit -m "test: add upload module integration tests"
```

---

## Task 6: Frontend — ChatInput 리디자인 (ChatGPT 스타일 pill 컨테이너)

**Files:**
- Rewrite: `web/src/components/chat/chat-input.tsx`

- [ ] **Step 1: chat-input.tsx 전면 리디자인**

`web/src/components/chat/chat-input.tsx` 전체를 교체. 핵심 변경사항:

1. **레이아웃**: `border-t` 구분선 제거 → pill 형태 컨테이너 (rounded-3xl)
2. **구조**: 파일 프리뷰 → textarea → 하단 툴바 (첨부 버튼 좌, 전송 버튼 우)
3. **파일 업로드**: 첨부 아이콘 클릭 → hidden input[type=file] → POST /api/upload → 프리뷰 표시
4. **상태 관리**: `files` 배열 state (id, name, path, status, previewUrl)
5. **전송 로직**: content에 `[file:경로]` 인라인 포함
6. **전송 버튼**: 원형, 빈 입력/업로드 중 비활성, 텍스트 or 파일 있으면 활성

```tsx
import { useState, useRef, useCallback } from 'react'
import { Paperclip, ArrowUp, X, Loader2, FileText } from 'lucide-react'

interface ChatInputProps {
  disabled: boolean
  onSend: (content: string) => void
}

interface UploadedFile {
  id: string
  name: string
  path: string | null      // null while uploading
  status: 'uploading' | 'done' | 'error'
  previewUrl: string | null // object URL for images
  abortController: AbortController | null
}

function isImageFile(name: string) {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(name)
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<UploadedFile[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isUploading = files.some((f) => f.status === 'uploading')
  const hasContent = value.trim().length > 0 || files.some((f) => f.status === 'done')
  const canSend = hasContent && !isUploading && !disabled

  const submit = useCallback(() => {
    if (!canSend) return

    const filePaths = files
      .filter((f) => f.status === 'done' && f.path)
      .map((f) => `[file:${f.path}]`)

    const parts = [value.trim(), ...filePaths].filter(Boolean)
    onSend(parts.join('\n'))

    setValue('')
    setFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [canSend, value, files, onSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const uploadFile = async (file: File) => {
    const id = crypto.randomUUID()
    const abortController = new AbortController()
    const previewUrl = isImageFile(file.name)
      ? URL.createObjectURL(file)
      : null

    const entry: UploadedFile = {
      id,
      name: file.name,
      path: null,
      status: 'uploading',
      previewUrl,
      abortController,
    }
    setFiles((prev) => [...prev, entry])

    try {
      const form = new FormData()
      form.append('file', file)

      const token = localStorage.getItem('token')
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
        signal: abortController.signal,
      })

      if (!res.ok) {
        throw new Error(`Upload failed: ${res.status}`)
      }

      const data = await res.json()
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, path: data.path, status: 'done' as const, abortController: null }
            : f
        )
      )
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Removed by user during upload
        return
      }
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status: 'error' as const, abortController: null } : f
        )
      )
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (!selected) return
    Array.from(selected).forEach(uploadFile)
    e.target.value = '' // reset so same file can be re-selected
  }

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.abortController) {
        file.abortController.abort()
      }
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
      return prev.filter((f) => f.id !== id)
    })
  }

  return (
    <div className="p-3 pb-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col gap-2 rounded-3xl border bg-muted/30 px-4 py-3 focus-within:border-ring">
          {/* File preview area */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="group relative h-20 w-20 overflow-hidden rounded-xl border bg-muted"
                >
                  {/* Thumbnail content */}
                  {f.previewUrl ? (
                    <img
                      src={f.previewUrl}
                      alt={f.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-primary/10">
                      <FileText className="h-5 w-5 text-primary/60" />
                      <span className="max-w-[64px] truncate px-1 text-[10px] text-muted-foreground">
                        {f.name}
                      </span>
                    </div>
                  )}
                  {/* Upload spinner overlay */}
                  {f.status === 'uploading' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                  {/* X remove button */}
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="메시지를 입력하세요..."
            disabled={disabled}
            rows={1}
            className="w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between">
            {/* Attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Send button */}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 개발 서버에서 확인**

Run: `cd web && pnpm dev`
확인사항:
- pill 형태 컨테이너가 렌더링되는지
- 빈 상태에서 전송 버튼이 비활성인지
- 텍스트 입력 시 전송 버튼이 활성화되는지
- 파일 첨부 아이콘 클릭 시 파일 선택 다이얼로그가 열리는지
- 파일 업로드 중 스피너가 표시되는지
- X 버튼으로 파일 삭제가 되는지

- [ ] **Step 3: Commit**

```bash
git add web/src/components/chat/chat-input.tsx
git commit -m "feat: redesign chat input to ChatGPT-style pill with file upload"
```

---

## Task 7: 드래그 방지 및 마무리

**Files:**
- Modify: `web/src/components/chat/chat-input.tsx`

- [ ] **Step 1: 컨테이너에 drag 이벤트 방지 추가**

pill 컨테이너 div에 추가 (브라우저 기본 드롭 핸들러가 페이지를 이동시키는 것 방지):
```tsx
<div
  className="flex flex-col gap-2 rounded-3xl border bg-muted/30 px-4 py-3 focus-within:border-ring"
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => e.preventDefault()}
>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/chat/chat-input.tsx
git commit -m "fix: prevent default browser drop behavior on input container"
```

---

## Task 8: .gitignore에 .temp 추가

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: .gitignore에 .temp/ 추가**

`.gitignore` 파일에 추가:
```
.temp/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .temp upload directory"
```
