use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::registry::BridgeRegistry;

// register, update_session은 FromRef<AppState>로 Arc<BridgeRegistry> 추출
// permission_request는 AppState 직접 사용

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
pub struct PermissionRequest {
    pub port: u16,
    pub request_id: String,
    pub tool_name: String,
    pub description: String,
    pub input_preview: String,
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

pub async fn permission_request(
    State(state): State<crate::state::AppState>,
    Json(req): Json<PermissionRequest>,
) -> Json<serde_json::Value> {
    // port로 bridge_id 조회
    let bridge_id = state.registry.find_by_port(req.port).map(|b| b.id.clone());
    if let Some(bid) = bridge_id {
        // 저장 (나중에 접속하는 클라이언트도 받을 수 있도록)
        state.registry.add_permission(super::registry::PendingPermission {
            bridge_id: bid.clone(),
            request_id: req.request_id.clone(),
            tool_name: req.tool_name.clone(),
            description: req.description.clone(),
            input_preview: req.input_preview.clone(),
        });

        let msg = serde_json::json!({
            "type": "permission_request",
            "bridge_id": bid,
            "request_id": req.request_id,
            "tool_name": req.tool_name,
            "description": req.description,
            "input_preview": req.input_preview,
        });
        state.ws_hub.broadcast_all(serde_json::to_string(&msg).unwrap()).await;
    }
    Json(serde_json::json!({"ok": true}))
}
