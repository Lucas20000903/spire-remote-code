use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

#[derive(Clone, Debug)]
pub struct BridgeInfo {
    pub id: String,
    pub port: u16,
    pub session_id: Option<String>,
    pub cwd: String,
    pub pid: u32,
    pub registered_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug)]
pub enum BridgeEvent {
    Registered(BridgeInfo),
    Unregistered(String),
    SessionUpdated { bridge_id: String, session_id: String },
}

pub struct BridgeRegistry {
    bridges: RwLock<HashMap<String, BridgeInfo>>,
    event_tx: broadcast::Sender<BridgeEvent>,
    message_queues: RwLock<HashMap<String, Vec<String>>>,
}

impl BridgeRegistry {
    pub fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(256);
        Arc::new(Self {
            bridges: RwLock::new(HashMap::new()),
            event_tx: tx,
            message_queues: RwLock::new(HashMap::new()),
        })
    }

    pub fn register(
        &self,
        port: u16,
        session_id: Option<String>,
        cwd: String,
        pid: u32,
    ) -> String {
        // 같은 pid의 기존 등록이 있으면 재사용 (MCP 재연결 시 bridge_id 유지)
        {
            let mut bridges = self.bridges.write().unwrap();
            if let Some(existing) = bridges.values_mut().find(|b| b.pid == pid) {
                let id = existing.id.clone();
                existing.port = port;
                existing.cwd = cwd;
                existing.registered_at = chrono::Utc::now();
                if session_id.is_some() {
                    existing.session_id = session_id;
                }
                let info = existing.clone();
                tracing::info!("bridge reused: {} (pid={}, port={})", id, pid, port);
                let _ = self.event_tx.send(BridgeEvent::Registered(info));
                return id;
            }
        }
        tracing::info!("bridge new: cwd={}, port={}, pid={}", cwd, port, pid);

        let id = format!("br-{}", uuid::Uuid::new_v4().as_simple());
        let info = BridgeInfo {
            id: id.clone(),
            port,
            session_id,
            cwd,
            pid,
            registered_at: chrono::Utc::now(),
        };
        self.bridges
            .write()
            .unwrap()
            .insert(id.clone(), info.clone());
        self.message_queues
            .write()
            .unwrap()
            .insert(id.clone(), Vec::new());
        let _ = self.event_tx.send(BridgeEvent::Registered(info));
        id
    }

    pub fn unregister(&self, id: &str) {
        self.bridges.write().unwrap().remove(id);
        self.message_queues.write().unwrap().remove(id);
        let _ = self
            .event_tx
            .send(BridgeEvent::Unregistered(id.to_string()));
    }

    pub fn update_session(&self, id: &str, session_id: String) {
        let mut bridges = self.bridges.write().unwrap();
        // Don't assign if another bridge already has this session_id
        let already_assigned = bridges.values().any(|b| b.session_id.as_deref() == Some(&session_id) && b.id != id);
        if already_assigned {
            return;
        }
        if let Some(bridge) = bridges.get_mut(id) {
            bridge.session_id = Some(session_id.clone());
        }
        drop(bridges);
        let _ = self.event_tx.send(BridgeEvent::SessionUpdated {
            bridge_id: id.to_string(),
            session_id,
        });
    }

    pub fn get(&self, id: &str) -> Option<BridgeInfo> {
        self.bridges.read().unwrap().get(id).cloned()
    }

    pub fn find_by_session(&self, session_id: &str) -> Option<BridgeInfo> {
        self.bridges
            .read()
            .unwrap()
            .values()
            .find(|b| b.session_id.as_deref() == Some(session_id))
            .cloned()
    }

    pub fn list_active(&self) -> Vec<BridgeInfo> {
        self.bridges.read().unwrap().values().cloned().collect()
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<BridgeEvent> {
        self.event_tx.subscribe()
    }

    pub fn queue_message(&self, bridge_id: &str, message: String) {
        if let Some(queue) = self.message_queues.write().unwrap().get_mut(bridge_id) {
            if queue.len() < 1000 {
                queue.push(message);
            }
        }
    }

    pub fn drain_queue(&self, bridge_id: &str) -> Vec<String> {
        self.message_queues
            .write()
            .unwrap()
            .get_mut(bridge_id)
            .map(|q| std::mem::take(q))
            .unwrap_or_default()
    }
}
