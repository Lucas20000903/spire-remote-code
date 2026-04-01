# Chat Input Redesign — ChatGPT Style + File Upload

## Summary

채팅 입력창을 ChatGPT 스타일의 pill 형태 컨테이너로 리디자인하고, 파일 첨부 기능을 프론트엔드 + Rust 백엔드에 걸쳐 구현한다.

## Goals

1. 입력창을 ChatGPT 스타일로 변경 (둥근 pill 컨테이너, 내부 툴바, 원형 전송 버튼)
2. 이미지 + 일반 파일 업로드 지원
3. 업로드된 파일은 Rust 서버의 `.temp/` 디렉토리에 저장
4. 전송 시 파일 경로를 메시지 content에 인라인으로 포함

## Architecture

### Data Flow

```
[Web UI] --multipart POST /upload--> [Rust Server] --> .temp/{uuid}-{filename}
                                                          |
[Web UI] --WS send_message--> [Rust] --SSE--> [Bridge] --MCP notification--> [Claude Code]
   content: "분석해줘\n[file:/abs/path/.temp/uuid-screenshot.png]"
```

### Components Changed

| Layer | File | Change |
|-------|------|--------|
| Rust | `src/main.rs` | `POST /upload` endpoint 추가, `.temp/` 디렉토리 관리 |
| Rust | `src/upload.rs` (new) | multipart 파일 수신, UUID 접두사로 저장, 절대 경로 반환 |
| Frontend | `web/src/components/chat/chat-input.tsx` | 전면 리디자인 |

## Frontend Design

### Input Container

- `border-t` 구분선 제거, 배경과 자연스럽게 통합
- 둥근 pill 컨테이너 (border-radius: 24px)
- 내부 구조: 파일 프리뷰 영역 (조건부) → textarea → 하단 툴바
- 하단 툴바: 좌측 첨부 버튼, 우측 전송 버튼 (원형)

### File Preview

- 80x80px 둥근 사각형 썸네일 (border-radius: 12px)
- 이미지: 실제 썸네일 표시
- 일반 파일: 파일 아이콘 + 파일명
- 각 썸네일 우상단에 X 버튼 (삭제, 업로드 중에도 가능)

### States

| State | 전송 버튼 | 파일 프리뷰 |
|-------|----------|------------|
| 빈 입력 | 비활성 (회색, opacity 0.5) | 숨김 |
| 텍스트만 | 활성 (흰색) | 숨김 |
| 업로드 중 | 비활성 | 썸네일 + 스피너 |
| 업로드 완료 | 활성 | 썸네일 (완료) |
| 파일만 (텍스트 없음) | 활성 | 썸네일 |

### Send Logic

전송 시 content 구성:
```
{사용자 텍스트}
[file:/absolute/path/.temp/uuid-filename.ext]
[file:/absolute/path/.temp/uuid-filename2.ext]
```

파일만 첨부하고 텍스트가 없으면 파일 경로만 전송.

## Backend Design (Rust)

### File Storage Location

`.temp/` 디렉토리는 서버 프로세스의 현재 작업 디렉토리(cwd) 기준 글로벌로 하나 생성한다. 세션/브릿지별로 분리하지 않는다. Claude Code가 로컬 파일 시스템에서 절대 경로로 접근하므로 위치만 일관되면 된다.

서버 시작 시 `{server_cwd}/.temp/`를 자동 생성한다.

### POST /api/upload

- `require_auth` 미들웨어 적용 (기존 보호된 라우트와 동일)
- Content-Type: `multipart/form-data`
- 파일을 `{server_cwd}/.temp/{uuid}-{original_filename}`에 저장
- Response: `{ "path": "/absolute/path/.temp/uuid-filename.ext", "name": "filename.ext" }`
- 파일 크기 제한: 50MB, 초과 시 HTTP 413 + `{ "error": "Payload too large" }` 반환
- 의존성: `axum`의 `multipart` feature 추가

### Cleanup

- `.temp/` 파일은 서버 재시작 시 정리하지 않음 (Claude Code가 참조할 수 있으므로)
- 향후 TTL 기반 정리 고려 가능 (현재 스코프 밖)

## Bridge / MCP

변경 없음. `[file:/path]` 형식은 파싱 대상이 아닌 plain text다. Claude Code의 LLM이 경로를 인식하고 Read tool 등으로 파일에 접근한다. Bridge나 MCP 프로토콜 수정 불필요.

## Testing

- Rust: upload endpoint 통합 테스트 (파일 저장 확인, 경로 반환)
- Frontend: 수동 테스트 (업로드 → 프리뷰 → 전송 → X 삭제)

## Out of Scope

- 드래그 앤 드롭 업로드
- 클립보드 붙여넣기
- 파일 TTL/자동 정리
- 업로드 진행률 표시 (퍼센트)
