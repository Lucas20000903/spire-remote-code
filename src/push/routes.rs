use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::db::DbPool;
use crate::error::AppError;

#[derive(Serialize)]
pub struct VapidKeyResponse {
    pub public_key: String,
}

#[derive(Deserialize)]
pub struct SubscribeRequest {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

/// GET /api/push/vapid-key - Returns the public VAPID key (auto-generated on first call).
pub async fn get_vapid_key(
    State(db): State<DbPool>,
) -> Result<Json<VapidKeyResponse>, AppError> {
    let conn = db.lock().unwrap();
    let key = match conn.query_row(
        "SELECT value FROM config WHERE key = 'vapid_public_key'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        Ok(k) => k,
        Err(_) => {
            let key_pair = generate_vapid_keys();
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('vapid_public_key', ?1)",
                [&key_pair.public_key],
            )
            .map_err(|e| AppError::Internal(e.into()))?;
            conn.execute(
                "INSERT INTO config (key, value) VALUES ('vapid_private_key', ?1)",
                [&key_pair.private_key],
            )
            .map_err(|e| AppError::Internal(e.into()))?;
            key_pair.public_key
        }
    };
    Ok(Json(VapidKeyResponse { public_key: key }))
}

/// POST /api/push/subscribe - Saves a PushSubscription to SQLite.
pub async fn subscribe(
    State(db): State<DbPool>,
    Json(req): Json<SubscribeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO push_subscription (user_id, endpoint, p256dh, auth) VALUES (1, ?1, ?2, ?3)",
        [&req.endpoint, &req.p256dh, &req.auth],
    )
    .map_err(|e| AppError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({"ok": true})))
}

/// Internal function to send push notifications when WebSocket is not connected.
/// Currently a stub that logs the intent; actual web-push sending is a TODO.
pub async fn send_push_notification(
    db: &DbPool,
    title: &str,
    body: &str,
    _data: &serde_json::Value,
) -> anyhow::Result<()> {
    let subscriptions = {
        let conn = db.lock().unwrap();
        let mut stmt = conn.prepare("SELECT endpoint, p256dh, auth FROM push_subscription")?;
        let subs: Vec<(String, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| anyhow::anyhow!(e))?
            .filter_map(|r| r.ok())
            .collect();
        subs
    };

    if subscriptions.is_empty() {
        tracing::debug!("No push subscriptions registered, skipping push");
        return Ok(());
    }

    // TODO: Implement actual web-push sending using a web-push crate.
    // This requires proper VAPID ECDSA P-256 key handling.
    tracing::info!(
        "Would send push to {} subscriber(s): {} - {}",
        subscriptions.len(),
        title,
        body
    );

    Ok(())
}

struct VapidKeyPair {
    public_key: String,
    private_key: String,
}

/// Generate placeholder VAPID keys.
/// In production, replace with proper ECDSA P-256 key generation.
fn generate_vapid_keys() -> VapidKeyPair {
    use uuid::Uuid;
    let id = Uuid::new_v4().to_string();
    VapidKeyPair {
        public_key: format!("vapid-pub-{}", &id[..8]),
        private_key: format!("vapid-priv-{}", &id[..8]),
    }
}
