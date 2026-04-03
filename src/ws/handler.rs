use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;

use crate::state::AppState;
use crate::terminal;

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
                    Some("permission_response") => {
                        handle_permission_response(&state, &parsed).await;
                    }
                    Some("mark_seen") => {
                        // Hook DB의 status를 seen으로 변경 (completed → idle)
                        if let Some(sid) = parsed["session_id"].as_str() {
                            let db = state.db.lock().unwrap();
                            let _ = db.execute(
                                "UPDATE hook_status SET status = 'seen' WHERE session_id = ?1 AND status = 'idle'",
                                [sid],
                            );
                        }
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
    let active_bridges = state.registry.list_active();
    let tmux_sessions = terminal::list_tmux_sessions().await;

    // Hook DB: tmux_session → (session_id, status, last_prompt) 매핑
    let hook_map: std::collections::HashMap<String, (String, String, String)> = {
        let db = state.db.lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT tmux_session, session_id, status, last_prompt FROM hook_status WHERE tmux_session != ''"
        ).unwrap();
        stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?),
            ))
        }).unwrap().filter_map(|r| r.ok()).collect()
    };

    let mut active = Vec::new();
    let mut used_bridge_ids = std::collections::HashSet::new();

    for ts in &tmux_sessions {
        // 1. Hook DB에서 tmux_session 이름으로 정확히 매칭 (가장 신뢰)
        let hook = hook_map.get(&ts.name);
        let hook_session_id = hook.map(|(sid, _, _)| sid.clone());

        // 2. Active Bridge 매칭: session_id로만 (cwd fallback 제거 — 같은 cwd에 여러 세션 있으면 잘못 매칭됨)
        let bridge = if let Some(ref hsid) = hook_session_id {
            active_bridges.iter().find(|b| {
                !used_bridge_ids.contains(&b.id) && b.session_id.as_deref() == Some(hsid.as_str())
            })
        } else {
            None
        };

        // bridge_id는 항상 tmux 기반 (URL 안정성)
        let bridge_id = format!("tmux:{}", ts.name);
        let (port, has_bridge) = if let Some(b) = bridge {
            used_bridge_ids.insert(b.id.clone());
            (b.port, true)
        } else {
            (0, false)
        };

        // session_id: Hook > Bridge > None
        let session_id = hook_session_id
            .or_else(|| bridge.and_then(|b| b.session_id.clone()));

        // Hook DB status를 우선 사용 (정확), fallback으로 JSONL 파싱
        let hook_db_status = hook.map(|(_, st, _)| st.as_str()).and_then(|st| match st {
            "idle" => Some("completed"),
            "seen" => Some("idle"),  // 유저가 확인한 세션
            "in-progress" | "tool-running" | "error" | "active" => Some(st),
            "disconnected" => None,
            _ => None,
        });

        let (last_msg, jsonl_status) = if let Some(ref sid) = session_id {
            let msg = get_last_user_message(&state.config.claude_projects_dir, sid).await;
            let st = get_session_status(&state.config.claude_projects_dir, sid).await;
            (msg, st)
        } else {
            (None, None)
        };

        let status = hook_db_status
            .map(String::from)
            .or(jsonl_status);

        active.push(serde_json::json!({
            "id": session_id,
            "cwd": ts.cwd,
            "port": port,
            "bridge_id": bridge_id,
            "tmux_session": ts.name,
            "command": &ts.command,
            "has_bridge": has_bridge,
            "lastUserMessage": last_msg,
            "status": status,
        }));
    }

    // tmux에 매칭 안 된 Bridge 세션 (tmux 없이 실행 중인 경우)
    for b in &active_bridges {
        if used_bridge_ids.contains(&b.id) { continue; }
        let (last_msg, status) = if let Some(ref sid) = b.session_id {
            let msg = get_last_user_message(&state.config.claude_projects_dir, sid).await;
            let st = get_session_status(&state.config.claude_projects_dir, sid).await;
            (msg, st)
        } else {
            (None, None)
        };
        active.push(serde_json::json!({
            "id": b.session_id,
            "cwd": b.cwd,
            "port": b.port,
            "bridge_id": b.id,
            "has_bridge": true,
            "lastUserMessage": last_msg,
            "status": status,
        }));
    }

    let msg = serde_json::json!({
        "type": "sessions",
        "active": active,
        "recent": [],
    });
    let _ = tx.send(serde_json::to_string(&msg).unwrap()).await;

    // pending permissions 전달 (앱을 늦게 열어도 받을 수 있도록)
    for perm in state.registry.list_permissions() {
        let perm_msg = serde_json::json!({
            "type": "permission_request",
            "bridge_id": perm.bridge_id,
            "request_id": perm.request_id,
            "tool_name": perm.tool_name,
            "description": perm.description,
            "input_preview": perm.input_preview,
        });
        let _ = tx.send(serde_json::to_string(&perm_msg).unwrap()).await;
    }
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

/// Read the last relevant message from a session's jsonl to determine status
async fn get_session_status(projects_dir: &std::path::Path, session_id: &str) -> Option<String> {
    let mut read_dir = tokio::fs::read_dir(projects_dir).await.ok()?;
    while let Some(entry) = read_dir.next_entry().await.ok()? {
        if entry.file_type().await.ok()?.is_dir() {
            let candidate = entry.path().join(format!("{}.jsonl", session_id));
            if candidate.exists() {
                let content = tokio::fs::read_to_string(&candidate).await.ok()?;
                // 뒤에서부터 마지막 관련 메시지 찾기
                for line in content.lines().rev() {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                        let entry_type = parsed["type"].as_str().unwrap_or("");
                        let content_val = &parsed["message"]["content"];

                        // 시스템 메시지 건너뛰기
                        if let Some(c) = content_val.as_str() {
                            if c.starts_with('<') || c.starts_with("Caveat:") || c.starts_with("This session") {
                                continue;
                            }
                        }

                        if entry_type == "assistant" {
                            let stop_reason = parsed["message"]["stop_reason"].as_str();
                            return match stop_reason {
                                Some("end_turn") => Some("completed".to_string()),
                                Some("tool_use") | None => Some("in-progress".to_string()),
                                _ => Some("idle".to_string()),
                            };
                        }
                        if entry_type == "user" {
                            // tool_result만 있는 메시지 건너뛰기
                            if let Some(arr) = content_val.as_array() {
                                if arr.iter().all(|b| b["type"].as_str() == Some("tool_result")) {
                                    continue;
                                }
                            }
                            return Some("in-progress".to_string());
                        }
                    }
                }
                return Some("idle".to_string());
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

async fn handle_permission_response(state: &AppState, msg: &serde_json::Value) {
    let bridge_id = match msg["bridge_id"].as_str() {
        Some(id) => id,
        None => return,
    };
    let request_id = match msg["request_id"].as_str() {
        Some(id) => id,
        None => return,
    };
    let behavior = match msg["behavior"].as_str() {
        Some(b) if b == "allow" || b == "deny" => b,
        _ => return,
    };

    // pending에서 제거
    state.registry.remove_permission(request_id);

    let event = serde_json::json!({
        "_event": "permission_response",
        "request_id": request_id,
        "behavior": behavior,
    });
    state
        .bridge_send(bridge_id, serde_json::to_string(&event).unwrap())
        .await;
}
