use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;

use crate::state::AppState;

pub async fn handle_ws(ws: WebSocket, state: Arc<AppState>) {
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
                    Some("permission_response") => {
                        handle_permission_response(&state, &parsed).await;
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

    // Client disconnected, abort the outbound task
    outbound.abort();
}

async fn handle_send_message(state: &AppState, msg: &serde_json::Value) {
    if let (Some(session_id), Some(content)) = (msg["session_id"].as_str(), msg["content"].as_str())
    {
        if let Some(bridge) = state.registry.find_by_session(session_id) {
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
}

async fn handle_permission_response(state: &AppState, msg: &serde_json::Value) {
    if let (Some(session_id), Some(request_id), Some(behavior)) = (
        msg["session_id"].as_str(),
        msg["request_id"].as_str(),
        msg["behavior"].as_str(),
    ) {
        if let Some(bridge) = state.registry.find_by_session(session_id) {
            let event = serde_json::json!({
                "type": "permission_response",
                "request_id": request_id,
                "behavior": behavior,
            });
            state
                .bridge_send(&bridge.id, serde_json::to_string(&event).unwrap())
                .await;
        }
    }
}

async fn handle_list_sessions(
    state: &AppState,
    tx: &tokio::sync::mpsc::Sender<String>,
) {
    let active: Vec<_> = state
        .registry
        .list_active()
        .iter()
        .map(|b| {
            serde_json::json!({
                "id": b.session_id,
                "cwd": b.cwd,
                "port": b.port,
                "bridge_id": b.id,
            })
        })
        .collect();
    let msg = serde_json::json!({
        "type": "sessions",
        "active": active,
        "recent": [],
    });
    let _ = tx.send(serde_json::to_string(&msg).unwrap()).await;
}

async fn handle_load_history(
    state: &AppState,
    msg: &serde_json::Value,
    tx: &tokio::sync::mpsc::Sender<String>,
) {
    let session_id = msg["session_id"].as_str().unwrap_or("");
    let limit = msg["limit"].as_u64().unwrap_or(50) as usize;
    let before = msg["before"].as_str();
    match crate::jsonl::watcher::load_history(
        &state.config.claude_projects_dir,
        session_id,
        limit,
        before,
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
        match crate::session::tmux::create_session(cwd).await {
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
