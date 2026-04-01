use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::bridge::registry::BridgeRegistry;
use crate::config::AppConfig;
use crate::db::DbPool;
use crate::ws::hub::WsHub;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub registry: Arc<BridgeRegistry>,
    pub ws_hub: WsHub,
    pub config: AppConfig,
    pub bridge_senders: Arc<RwLock<HashMap<String, tokio::sync::mpsc::Sender<String>>>>,
    pub ws_client_count: Arc<std::sync::atomic::AtomicUsize>,
}

impl AppState {
    pub async fn bridge_send(&self, bridge_id: &str, msg: String) {
        let senders = self.bridge_senders.read().await;
        if let Some(tx) = senders.get(bridge_id) {
            let _ = tx.send(msg).await;
        } else {
            self.registry.queue_message(bridge_id, msg);
        }
    }

    pub fn has_ws_clients(&self) -> bool {
        self.ws_client_count
            .load(std::sync::atomic::Ordering::Relaxed)
            > 0
    }
}
