use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;

use crate::state::AppState;

pub async fn handle_ws(ws: WebSocket, state: Arc<AppState>) {
    state.ws_client_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (mut sender, mut receiver) = ws.split();
    let hub = &state.ws_hub;

    // Global event subscription (session registered/unregistered)
    let mut global_rx = hub.subscribe_global();

    // Channel for forwarding session-specific messages to the outbound task
    let (session_tx, mut session_rx) = tokio::sync::mpsc::channel::<String>(256);

    // Outbound: server -> client
    let outbound = tokio::spawn(async move {
        loop {
            tokio::select! {
                result = global_rx.recv() => {
                    match result {
                        Ok(msg) => {
                            if sender.send(Message::Text(msg.into())).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    }
                }
                Some(msg) = session_rx.recv() => {
                    if sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Inbound: client -> server
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            let text = text.to_string();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                match parsed["type"].as_str() {
                    Some("subscribe") => {
                        if let Some(sid) = parsed["session_id"].as_str() {
                            let mut rx = hub.subscribe_session(sid).await;
                            let tx = session_tx.clone();
                            tokio::spawn(async move {
                                while let Ok(msg) = rx.recv().await {
                                    if tx.send(msg).await.is_err() {
                                        break;
                                    }
                                }
                            });
                        }
                    }
                    Some("unsubscribe") => {
                        // Unsubscribe is handled by dropping the rx when the
                        // spawned task ends (client disconnects or new subscribe replaces it)
                    }
                    Some("send_message") => {
                        handle_send_message(&state, &parsed).await;
                    }
                    Some("list_sessions") => {
                        handle_list_sessions(&state, &session_tx).await;
                    }
                    Some("load_history") => {
                        handle_load_history(&state, &parsed, &session_tx).await;
                    }
                    Some("create_session") => {
                        handle_create_session(&state, &parsed, &session_tx).await;
                    }
                    _ => {}
                }
            }
        }
    }

    // Client disconnected
    state.ws_client_count.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    outbound.abort();
}

async fn handle_send_message(state: &AppState, msg: &serde_json::Value) {
    let content = match msg["content"].as_str() {
        Some(c) => c,
        None => return,
    };

    // bridge_id 직접 지정 > session_id로 검색
    let bridge = msg["bridge_id"]
        .as_str()
        .and_then(|id| state.registry.get(id))
        .or_else(|| {
            msg["session_id"]
                .as_str()
                .and_then(|sid| state.registry.find_by_session(sid))
        });

    if let Some(bridge) = bridge {
        let chat_id = uuid::Uuid::new_v4().to_string();
        let event = serde_json::json!({
            "type": "send_message",
            "chat_id": chat_id,
            "content": content,
        });
        state
            .bridge_send(&bridge.id, serde_json::to_string(&event).unwrap())
            .await;
    }
}

async fn handle_list_sessions(
    state: &AppState,
    tx: &tokio::sync::mpsc::Sender<String>,
) {
    let bridges = state.registry.list_active();
    let mut active = Vec::new();
    for b in &bridges {
        let last_msg = if let Some(ref sid) = b.session_id {
            get_last_user_message(&state.config.claude_projects_dir, sid).await
        } else {
            None
        };
        active.push(serde_json::json!({
            "id": b.session_id,
            "cwd": b.cwd,
            "port": b.port,
            "bridge_id": b.id,
            "lastUserMessage": last_msg,
        }));
    }
    let msg = serde_json::json!({
        "type": "sessions",
        "active": active,
        "recent": [],
    });
    let _ = tx.send(serde_json::to_string(&msg).unwrap()).await;
}

async fn get_last_user_message(projects_dir: &std::path::Path, session_id: &str) -> Option<String> {
    // session_id로 jsonl 파일 찾기
    let mut read_dir = tokio::fs::read_dir(projects_dir).await.ok()?;
    while let Some(entry) = read_dir.next_entry().await.ok()? {
        if entry.file_type().await.ok()?.is_dir() {
            let candidate = entry.path().join(format!("{}.jsonl", session_id));
            if candidate.exists() {
                let content = tokio::fs::read_to_string(&candidate).await.ok()?;
                // 뒤에서부터 마지막 유저 메시지 찾기
                for line in content.lines().rev() {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                        if parsed["type"].as_str() == Some("user") {
                            if let Some(c) = parsed["message"]["content"].as_str() {
                                // channel 메시지에서 텍스트 추출
                                if let Some(cap) = c.find("<channel") {
                                    if let Some(end) = c.find("</channel>") {
                                        let inner = &c[c[cap..].find('>').map(|i| cap + i + 1).unwrap_or(cap)..end];
                                        let text = inner.trim();
                                        if !text.is_empty() {
                                            return Some(text.chars().take(60).collect());
                                        }
                                    }
                                }
                                // 시스템 메시지 건너뛰기
                                if c.starts_with('<') || c.starts_with("Caveat:") || c.starts_with("This session") {
                                    continue;
                                }
                                return Some(c.chars().take(60).collect());
                            }
                        }
                    }
                }
                return None;
            }
        }
    }
    None
}

async fn handle_load_history(
    state: &AppState,
    msg: &serde_json::Value,
    tx: &tokio::sync::mpsc::Sender<String>,
) {
    let session_id = msg["session_id"].as_str().unwrap_or("");
    let limit = msg["limit"].as_u64().unwrap_or(50) as usize;
    let before = msg["before"].as_str();
    // cwd를 bridge registry에서 조회
    let cwd = msg["cwd"].as_str().map(String::from).or_else(|| {
        state.registry.find_by_session(session_id).map(|b| b.cwd)
    });
    match crate::jsonl::watcher::load_history(
        &state.config.claude_projects_dir,
        session_id,
        limit,
        before,
        cwd.as_deref(),
    )
    .await
    {
        Ok(entries) => {
            let resp = serde_json::json!({
                "type": "history",
                "session_id": session_id,
                "messages": entries,
            });
            let _ = tx.send(serde_json::to_string(&resp).unwrap()).await;
        }
        Err(e) => {
            let resp = serde_json::json!({
                "type": "error",
                "message": e.to_string(),
            });
            let _ = tx.send(serde_json::to_string(&resp).unwrap()).await;
        }
    }
}

async fn handle_create_session(
    state: &AppState,
    msg: &serde_json::Value,
    tx: &tokio::sync::mpsc::Sender<String>,
) {
    let _ = state; // AppState may be needed for future session tracking
    if let Some(cwd) = msg["cwd"].as_str() {
        match crate::session::spawner::create_session(cwd).await {
            Ok(tmux_session) => {
                let resp = serde_json::json!({
                    "type": "session_creating",
                    "cwd": cwd,
                    "tmux_session": tmux_session,
                });
                let _ = tx.send(serde_json::to_string(&resp).unwrap()).await;
            }
            Err(e) => {
                let resp = serde_json::json!({
                    "type": "session_create_failed",
                    "error": e.to_string(),
                });
                let _ = tx.send(serde_json::to_string(&resp).unwrap()).await;
            }
        }
    }
}
