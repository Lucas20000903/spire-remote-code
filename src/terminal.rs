use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use pty_process::{self, Size};
use serde::Deserialize;
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{auth, error::AppError, state::AppState};

/// LaunchAgent 환경에서도 tmux를 찾을 수 있도록 전체 경로 + 소켓 경로 설정
fn tmux_cmd() -> tokio::process::Command {
    let bin = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .copied()
        .unwrap_or("tmux");
    let mut cmd = tokio::process::Command::new(bin);
    // LaunchAgent 환경에서 tmux 소켓을 찾을 수 있도록 TMUX_TMPDIR 설정
    let uid = unsafe { libc::getuid() };
    let socket_dir = format!("/private/tmp/tmux-{}", uid);
    if std::path::Path::new(&socket_dir).exists() {
        cmd.env("TMUX_TMPDIR", "/private/tmp");
    }
    cmd
}

#[derive(Deserialize)]
pub struct TermQuery {
    pub session: String,
    pub token: String,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 { 80 }
fn default_rows() -> u16 { 24 }

async fn tmux_session_exists(name: &str) -> bool {
    tmux_cmd()
        .args(["has-session", "-t", name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// grouped session 생성 (독립 resize 가능). base 세션 이름에서 고정 이름 생성.
async fn create_grouped_session(base: &str) -> anyhow::Result<String> {
    let mobile_name = format!("spire-mobile-{}", base);

    // 기존 mobile 세션이 있으면 제거 후 재생성
    let _ = tmux_cmd()
        .args(["kill-session", "-t", &mobile_name])
        .output()
        .await;

    let output = tmux_cmd()
        .args(["new-session", "-d", "-s", &mobile_name, "-t", base])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!(
            "grouped session 생성 실패: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(mobile_name)
}

/// grouped session 정리
async fn cleanup_grouped_session(mobile_name: &str) {
    let _ = tmux_cmd()
        .args(["kill-session", "-t", mobile_name])
        .output()
        .await;
}

/// 서버 시작 시 stale grouped session 정리
pub async fn cleanup_stale_mobile_sessions() {
    let output = tmux_cmd()
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .await;

    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for name in stdout.lines() {
            if name.starts_with("spire-mobile-") {
                let _ = tmux_cmd()
                    .args(["kill-session", "-t", name])
                    .output()
                    .await;
                tracing::info!("cleaned up stale mobile session: {}", name);
            }
        }
    }
}

/// tmux 세션 목록 조회
pub async fn list_tmux_sessions() -> Vec<TmuxSession> {
    let output = tmux_cmd()
        .args([
            "list-sessions",
            "-F",
            "#{session_name}|||#{session_activity}|||#{session_attached}|||#{session_created}|||#{pane_current_command}",
        ])
        .output()
        .await;

    let Ok(output) = output else { return vec![] };
    if !output.status.success() { return vec![]; }

    let procs = load_process_table().await;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut sessions = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split("|||").collect();
        if parts.len() < 4 { continue; }

        let name = parts[0].to_string();
        if name.starts_with("spire-mobile-") { continue; }

        let activity = parts[1].parse::<i64>().unwrap_or(0);
        let attached = parts[2] == "1";
        let created = parts[3].parse::<i64>().unwrap_or(0);
        let command = parts.get(4).unwrap_or(&"").to_string();

        let cwd = get_session_cwd(&name).await.unwrap_or_default();
        let pane_pid = get_pane_pid(&name).await.unwrap_or(0);
        let (descendants, has_claude) = get_descendants_and_claude(&procs, pane_pid);

        sessions.push(TmuxSession {
            name,
            cwd,
            activity,
            attached,
            created,
            command: if has_claude { "claude".to_string() } else { command },
            descendant_pids: descendants,
        });
    }

    sessions
}

/// 프로세스 테이블을 한 번 읽어서 (pid → ppid, comm) 맵 생성
async fn load_process_table() -> Vec<(u32, u32, String)> {
    let output = tokio::process::Command::new("ps")
        .args(["-eo", "pid,ppid,comm"])
        .output()
        .await;

    let Ok(output) = output else { return vec![] };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                let pid = parts[0].parse::<u32>().ok()?;
                let ppid = parts[1].parse::<u32>().ok()?;
                Some((pid, ppid, parts[2].to_string()))
            } else {
                None
            }
        })
        .collect()
}

/// pane_pid의 자손 PID + claude 실행 여부를 한번에 구함
/// pane_pid 자체의 comm도 확인 (claude가 직접 pane 프로세스인 경우)
fn get_descendants_and_claude(
    procs: &[(u32, u32, String)],
    pane_pid: u32,
) -> (Vec<u32>, bool) {
    let mut descendants = Vec::new();
    let mut has_claude = procs.iter().any(|(pid, _, comm)| *pid == pane_pid && comm.contains("claude"));
    let mut queue = vec![pane_pid];
    while let Some(parent) = queue.pop() {
        for (pid, ppid, comm) in procs {
            if *ppid == parent {
                descendants.push(*pid);
                if comm.contains("claude") {
                    has_claude = true;
                }
                queue.push(*pid);
            }
        }
    }
    (descendants, has_claude)
}

/// pane_pid 조회
async fn get_pane_pid(session_name: &str) -> Option<u32> {
    let output = tmux_cmd()
        .args(["list-panes", "-t", session_name, "-F", "#{pane_pid}"])
        .output()
        .await
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()
        .and_then(|s| s.parse().ok())
}

async fn get_session_cwd(session_name: &str) -> Option<String> {
    let output = tmux_cmd()
        .args(["display", "-t", session_name, "-p", "#{pane_current_path}"])
        .output()
        .await
        .ok()?;

    if !output.status.success() { return None; }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[derive(serde::Serialize, Clone)]
pub struct TmuxSession {
    pub name: String,
    pub cwd: String,
    pub activity: i64,
    pub attached: bool,
    pub created: i64,
    pub command: String,
    /// pane_pid의 자손 PID 목록 (Bridge PID 매칭용)
    #[serde(skip)]
    pub descendant_pids: Vec<u32>,
}

/// GET /api/tmux/sessions
pub async fn tmux_sessions_handler() -> impl IntoResponse {
    let sessions = list_tmux_sessions().await;
    axum::Json(sessions)
}

/// GET /api/tmux/debug — 디버그용: 각 세션의 descendants와 매칭 정보
pub async fn tmux_debug_handler(State(state): State<AppState>) -> impl IntoResponse {
    let sessions = list_tmux_sessions().await;
    let bridges = state.registry.list_active();

    let mut result = Vec::new();
    for ts in &sessions {
        let bridge_match = bridges.iter().find(|b| {
            ts.descendant_pids.contains(&(b.pid as u32))
        });
        result.push(serde_json::json!({
            "tmux": ts.name,
            "cwd": ts.cwd,
            "command": ts.command,
            "descendant_count": ts.descendant_pids.len(),
            "descendants_sample": &ts.descendant_pids[..ts.descendant_pids.len().min(20)],
            "bridge_pid_match": bridge_match.map(|b| serde_json::json!({
                "bridge_id": b.id,
                "bridge_pid": b.pid,
                "session_id": b.session_id,
            })),
        }));
    }
    axum::Json(result)
}

/// WebSocket 핸들러: 브라우저 ↔ tmux PTY (grouped session으로 독립 resize)
pub async fn terminal_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<TermQuery>,
) -> Result<impl IntoResponse, AppError> {
    // JWT 인증
    let secret = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT value FROM config WHERE key = 'jwt_secret'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| AppError::Unauthorized)?
    };
    auth::jwt::verify_token(&query.token, &secret).map_err(|_| AppError::Unauthorized)?;

    if !tmux_session_exists(&query.session).await {
        return Err(AppError::BadRequest(format!(
            "tmux session '{}' not found",
            query.session
        )));
    }

    let session = query.session.clone();
    let cols = query.cols;
    let rows = query.rows;

    Ok(ws.on_upgrade(move |socket| handle_terminal(socket, session, cols, rows)))
}

async fn handle_terminal(socket: WebSocket, base_session: String, cols: u16, rows: u16) {
    // grouped session 생성 (폰 화면 크기가 원본 터미널에 영향 주지 않도록)
    let mobile_session = match create_grouped_session(&base_session).await {
        Ok(name) => name,
        Err(e) => {
            tracing::error!("grouped session 생성 실패: {}", e);
            return;
        }
    };

    // PTY 할당
    let (pty, pts) = match pty_process::open() {
        Ok(pair) => pair,
        Err(e) => {
            tracing::error!("PTY 할당 실패: {}", e);
            cleanup_grouped_session(&mobile_session).await;
            return;
        }
    };

    if let Err(e) = pty.resize(Size::new(rows, cols)) {
        tracing::warn!("PTY 크기 설정 실패: {}", e);
    }

    // mobile grouped session에 attach
    let tmux_bin = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .copied()
        .unwrap_or("tmux");
    let home = std::env::var("HOME").unwrap_or_else(|_| {
        dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
    });
    let cmd = pty_process::Command::new(tmux_bin)
        .env("TERM", "xterm-256color")
        .env("LANG", "ko_KR.UTF-8")
        .env("LC_ALL", "ko_KR.UTF-8")
        .env("TMUX_TMPDIR", "/private/tmp")
        .env("HOME", &home)
        .args(["attach", "-t", &mobile_session]);
    let mut child: tokio::process::Child = match cmd.spawn(pts) {
        Ok(child) => child,
        Err(e) => {
            tracing::error!("tmux attach 실패: {}", e);
            cleanup_grouped_session(&mobile_session).await;
            return;
        }
    };

    tracing::info!("terminal connected: {} → {}", base_session, mobile_session);

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (mut pty_reader, mut pty_writer): (pty_process::OwnedReadPty, pty_process::OwnedWritePty) = pty.into_split();

    // PTY 출력 → WebSocket (Binary)
    let pty_to_ws = tokio::spawn(async move {
        let mut buf = [0u8; 8192];
        loop {
            match pty_reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_sender
                        .send(Message::Binary(buf[..n].to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // WebSocket → PTY 입력
    let ws_to_pty = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Binary(data) => {
                    if pty_writer.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Message::Text(ref text) => {
                    // JSON 제어 메시지
                    if let Ok(ctrl) = serde_json::from_str::<ControlMessage>(text) {
                        match ctrl {
                            ControlMessage::Resize { cols, rows } => {
                                let _ = pty_writer.resize(Size::new(rows, cols));
                            }
                            ControlMessage::Input { data } => {
                                if pty_writer.write_all(data.as_bytes()).await.is_err() {
                                    break;
                                }
                            }
                        }
                    } else {
                        // 일반 텍스트 → 입력
                        if pty_writer.write_all(text.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // 하나라도 끝나면 정리
    tokio::select! {
        _ = pty_to_ws => {},
        _ = ws_to_pty => {},
        _ = child.wait() => {},
    }

    // grouped session 정리
    cleanup_grouped_session(&mobile_session).await;
    tracing::info!("terminal disconnected: {}", base_session);
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ControlMessage {
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "input")]
    Input { data: String },
}
