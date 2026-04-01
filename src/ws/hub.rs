use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

#[derive(Clone)]
pub struct WsHub {
    session_channels: Arc<RwLock<HashMap<String, broadcast::Sender<String>>>>,
    global_tx: broadcast::Sender<String>,
}

impl WsHub {
    pub fn new() -> Self {
        let (global_tx, _) = broadcast::channel(256);
        Self {
            session_channels: Arc::new(RwLock::new(HashMap::new())),
            global_tx,
        }
    }

    pub async fn subscribe_session(&self, session_id: &str) -> broadcast::Receiver<String> {
        let mut channels = self.session_channels.write().await;
        let tx = channels
            .entry(session_id.to_string())
            .or_insert_with(|| broadcast::channel(256).0);
        tx.subscribe()
    }

    pub async fn broadcast_to_session(&self, session_id: &str, msg: String) {
        let channels = self.session_channels.read().await;
        if let Some(tx) = channels.get(session_id) {
            let _ = tx.send(msg);
        }
    }

    pub fn subscribe_global(&self) -> broadcast::Receiver<String> {
        self.global_tx.subscribe()
    }

    pub async fn broadcast_all(&self, msg: String) {
        let _ = self.global_tx.send(msg);
    }
}
