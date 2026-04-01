use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::registry::BridgeRegistry;

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub port: u16,
    pub session_id: Option<String>,
    pub cwd: String,
    pub pid: u32,
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub bridge_id: String,
}

#[derive(Deserialize)]
pub struct UpdateSessionRequest {
    pub bridge_id: String,
    pub session_id: String,
}

#[derive(Deserialize)]
pub struct BridgeReply {
    pub port: u16,
    pub chat_id: String,
    pub text: String,
}

pub async fn register(
    State(registry): State<Arc<BridgeRegistry>>,
    Json(req): Json<RegisterRequest>,
) -> Json<RegisterResponse> {
    let id = registry.register(req.port, req.session_id, req.cwd, req.pid);
    Json(RegisterResponse { bridge_id: id })
}

pub async fn update_session(
    State(registry): State<Arc<BridgeRegistry>>,
    Json(req): Json<UpdateSessionRequest>,
) -> Json<serde_json::Value> {
    registry.update_session(&req.bridge_id, req.session_id);
    Json(serde_json::json!({"ok": true}))
}

// reply and permission_request will be connected via WsHub in Task 5
