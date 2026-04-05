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
                    Some("close_session") => {
                        handle_close_session(&state, &parsed, &session_tx).await;
                    }
                    Some("load_tasks") => {
                        handle_load_tasks(&state, &parsed, &session_tx).await;
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

    // bridge_id(= tmux 세션 이름) 직접 조회 > session_id로 검색
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

    // Hook DB: tmux_session → (session_id, status, last_prompt, updated_at) 매핑
    let hook_map: std::collections::HashMap<String, (String, String, String, String)> = {
        let db = state.db.lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT tmux_session, session_id, status, last_prompt, updated_at FROM hook_status WHERE tmux_session != ''"
        ).unwrap();
        stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?),
            ))
        }).unwrap().filter_map(|r| r.ok()).collect()
    };

    let mut active = Vec::new();
    let mut used_bridge_ids = std::collections::HashSet::new();

    for ts in &tmux_sessions {
        // 1. Hook DB에서 tmux_session 이름으로 정확히 매칭 (가장 신뢰)
        let hook = hook_map.get(&ts.name);
        let hook_session_id = hook.map(|(sid, _, _, _)| sid.clone());

        // 2. Active Bridge 매칭:
        //    a) Bridge ID == tmux 세션 이름 (Registry가 tmux_session을 키로 사용)
        //    b) Hook session_id로 매칭
        let bridge = active_bridges.iter().find(|b| {
            !used_bridge_ids.contains(&b.id) && b.id == ts.name
        }).or_else(|| {
            if let Some(ref hsid) = hook_session_id {
                active_bridges.iter().find(|b| {
                    !used_bridge_ids.contains(&b.id) && b.session_id.as_deref() == Some(hsid.as_str())
                })
            } else {
                None
            }
        });

        let bridge_id = ts.name.clone();
        let (port, has_bridge) = if let Some(b) = bridge {
            used_bridge_ids.insert(b.id.clone());
            (b.port, true)
        } else {
            (0, false)
        };

        // session_id: Bridge(정확) > Hook > None
        let session_id = bridge.and_then(|b| b.session_id.clone())
            .or(hook_session_id);

        // Hook DB status를 우선 사용 (정확), fallback으로 JSONL 파싱
        // 진행 중 상태가 5분 이상 오래됐으면 stale로 판단 → JSONL fallback
        let hook_db_status = hook.and_then(|(_, st, _, updated_at)| {
            let is_active_status = matches!(st.as_str(), "in-progress" | "tool-running" | "active");
            if is_active_status {
                let is_stale = chrono::DateTime::parse_from_rfc3339(updated_at)
                    .map(|t| chrono::Utc::now().signed_duration_since(t).num_minutes() > 5)
                    .unwrap_or(true);
                if is_stale { return None; }
            }
            match st.as_str() {
                "idle" => Some("completed"),
                "seen" => Some("idle"),
                "in-progress" | "tool-running" | "error" | "active" => Some(st.as_str()),
                "disconnected" => None,
                _ => None,
            }
        }).map(String::from);

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


/// JSONL 전체에서 TaskCreate/TaskUpdate tool_use만 추출하여 task 목록 반환
async fn handle_load_tasks(
    state: &AppState,
    msg: &serde_json::Value,
    tx: &tokio::sync::mpsc::Sender<String>,
) {
    let session_id = msg["session_id"].as_str().unwrap_or("");
    if session_id.is_empty() { return; }

    // JSONL 파일 찾기
    let path = {
        let projects_dir = &state.config.claude_projects_dir;
        let mut found = None;
        if let Ok(mut read_dir) = tokio::fs::read_dir(projects_dir).await {
            while let Ok(Some(entry)) = read_dir.next_entry().await {
                if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    let candidate = entry.path().join(format!("{}.jsonl", session_id));
                    if candidate.exists() {
                        found = Some(candidate);
                        break;
                    }
                }
            }
        }
        found
    };

    let Some(path) = path else {
        let _ = tx.send(serde_json::json!({"type": "tasks", "session_id": session_id, "tasks": []}).to_string()).await;
        return;
    };

    // JSONL 전체 스캔 — TaskCreate/TaskUpdate만 추출
    let content = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(_) => {
            let _ = tx.send(serde_json::json!({"type": "tasks", "session_id": session_id, "tasks": []}).to_string()).await;
            return;
        }
    };

    let mut tasks: std::collections::BTreeMap<u64, serde_json::Value> = std::collections::BTreeMap::new();
    let mut auto_id: u64 = 0;
    // tool_use_id → tool_result content 매핑
    let mut result_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // 1차: tool_result 수집
    for line in content.lines() {
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line.trim()) else { continue };
        let Some(msg) = entry.get("message") else { continue };
        let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) else { continue };
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                if let Some(tuid) = block.get("tool_use_id").and_then(|t| t.as_str()) {
                    let text = if let Some(s) = block.get("content").and_then(|c| c.as_str()) {
                        s.to_string()
                    } else if let Some(arr) = block.get("content").and_then(|c| c.as_array()) {
                        arr.iter().filter_map(|b| b.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("")
                    } else {
                        String::new()
                    };
                    result_map.insert(tuid.to_string(), text);
                }
            }
        }
    }

    // 2차: TaskCreate/TaskUpdate 처리
    for line in content.lines() {
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line.trim()) else { continue };
        let Some(msg) = entry.get("message") else { continue };
        let Some(blocks) = msg.get("content").and_then(|c| c.as_array()) else { continue };
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") { continue; }
            let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let input = block.get("input");

            if name == "TaskCreate" {
                let subject = input.and_then(|i| i.get("subject")).and_then(|s| s.as_str()).unwrap_or("");
                let desc = input.and_then(|i| i.get("description")).and_then(|s| s.as_str()).unwrap_or("");
                // tool_result에서 Task #N 파싱
                let tuid = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                let parsed_id = result_map.get(tuid).and_then(|text| {
                    text.find("Task #").and_then(|pos| {
                        text[pos + 6..].split(|c: char| !c.is_ascii_digit()).next()?.parse::<u64>().ok()
                    })
                });
                let task_id = parsed_id.unwrap_or_else(|| { auto_id += 1; auto_id });
                tasks.insert(task_id, serde_json::json!({
                    "id": task_id,
                    "subject": subject,
                    "description": desc,
                    "status": "open",
                }));
            } else if name == "TaskUpdate" {
                let raw_id = input.and_then(|i| i.get("taskId").or(i.get("id")));
                let task_id = raw_id.and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or(v.as_u64()));
                if let Some(tid) = task_id {
                    if let Some(task) = tasks.get_mut(&tid) {
                        if let Some(st) = input.and_then(|i| i.get("status")).and_then(|s| s.as_str()) {
                            task["status"] = serde_json::Value::String(st.to_string());
                        }
                    }
                }
            }
        }
    }

    let task_list: Vec<_> = tasks.values().collect();
    let _ = tx.send(serde_json::json!({
        "type": "tasks",
        "session_id": session_id,
        "tasks": task_list,
    }).to_string()).await;
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

async fn handle_close_session(
    state: &AppState,
    msg: &serde_json::Value,
    tx: &tokio::sync::mpsc::Sender<String>,
) {
    let tmux_session = match msg["tmux_session"].as_str() {
        Some(s) => s,
        None => return,
    };

    tracing::info!("close_session: tmux kill-session {}", tmux_session);

    // tmux kill-session 실행
    let output = crate::terminal::kill_tmux_session(tmux_session).await;
    let ok = output.is_ok();

    if ok {
        // Bridge registry에서 해제 (bridge_id = tmux 세션 이름)
        state.registry.unregister(tmux_session);

        // 세션 목록 갱신 전달
        handle_list_sessions(state, tx).await;
    } else {
        let resp = serde_json::json!({
            "type": "session_close_failed",
            "tmux_session": tmux_session,
            "error": output.err().map(|e| e.to_string()).unwrap_or_default(),
        });
        let _ = tx.send(serde_json::to_string(&resp).unwrap()).await;
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
