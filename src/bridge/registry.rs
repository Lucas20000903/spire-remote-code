use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

use crate::db::DbPool;

#[derive(Clone, Debug, serde::Serialize)]
pub struct PendingPermission {
    pub bridge_id: String,
    pub request_id: String,
    pub tool_name: String,
    pub description: String,
    pub input_preview: String,
}

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
    pending_permissions: RwLock<Vec<PendingPermission>>,
    db: DbPool,
}

impl BridgeRegistry {
    pub fn new(db: DbPool) -> Arc<Self> {
        let (tx, _) = broadcast::channel(256);

        // 서버 시작 시 이전 active 세션을 disconnected로 변경
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE session SET status = 'disconnected' WHERE status = 'active'",
                [],
            )
            .ok();
        }

        Arc::new(Self {
            bridges: RwLock::new(HashMap::new()),
            event_tx: tx,
            message_queues: RwLock::new(HashMap::new()),
            pending_permissions: RwLock::new(Vec::new()),
            db,
        })
    }

    pub fn register(
        &self,
        port: u16,
        session_id: Option<String>,
        cwd: String,
        pid: u32,
        tmux_session: Option<String>,
    ) -> String {
        // 키 결정: tmux 세션 이름 > br-{uuid} 폴백
        let id = tmux_session.clone()
            .unwrap_or_else(|| format!("br-{}", uuid::Uuid::new_v4().as_simple()));

        // 기존 등록이 있으면 pid/port만 업데이트 (MCP 재연결 시 키 유지)
        let mut bridges = self.bridges.write().unwrap();
        let merged_session = if let Some(existing) = bridges.get(&id) {
            session_id.or(existing.session_id.clone())
        } else {
            // hook_status에서 session_id 복원 시도
            session_id.or_else(|| {
                tmux_session.as_ref().and_then(|ts| {
                    let conn = self.db.lock().unwrap();
                    conn.query_row(
                        "SELECT session_id FROM hook_status WHERE tmux_session = ?1 AND session_id != ''",
                        [ts],
                        |r| r.get::<_, String>(0),
                    ).ok()
                })
            })
        };

        let info = BridgeInfo {
            id: id.clone(),
            port,
            session_id: merged_session,
            cwd,
            pid,
            registered_at: chrono::Utc::now(),
        };
        bridges.insert(id.clone(), info.clone());
        drop(bridges);

        self.message_queues.write().unwrap().entry(id.clone()).or_default();
        self.db_upsert_session(&info);
        let _ = self.event_tx.send(BridgeEvent::Registered(info));

        tracing::info!("bridge registered: {} (pid={}, port={})", id, pid, port);
        id
    }

    pub fn unregister(&self, id: &str) {
        self.bridges.write().unwrap().remove(id);
        self.message_queues.write().unwrap().remove(id);
        self.pending_permissions
            .write()
            .unwrap()
            .retain(|p| p.bridge_id != id);
        // DB: disconnected로 변경 (삭제하지 않음)
        {
            let conn = self.db.lock().unwrap();
            conn.execute(
                "UPDATE session SET status = 'disconnected', last_active = datetime('now') WHERE id = ?1",
                [id],
            )
            .ok();
        }
        let _ = self
            .event_tx
            .send(BridgeEvent::Unregistered(id.to_string()));
    }

    pub fn update_session(&self, id: &str, session_id: String) {
        let mut bridges = self.bridges.write().unwrap();
        // Don't assign if another bridge already has this session_id
        let already_assigned = bridges
            .values()
            .any(|b| b.session_id.as_deref() == Some(&session_id) && b.id != id);
        if already_assigned {
            return;
        }
        if let Some(bridge) = bridges.get_mut(id) {
            bridge.session_id = Some(session_id.clone());
        }
        drop(bridges);
        // DB 업데이트
        {
            let conn = self.db.lock().unwrap();
            conn.execute(
                "UPDATE session SET session_id = ?1, last_active = datetime('now') WHERE id = ?2",
                rusqlite::params![session_id, id],
            )
            .ok();
        }
        let _ = self.event_tx.send(BridgeEvent::SessionUpdated {
            bridge_id: id.to_string(),
            session_id,
        });
    }

    pub fn get(&self, id: &str) -> Option<BridgeInfo> {
        self.bridges.read().unwrap().get(id).cloned()
    }

    pub fn find_by_port(&self, port: u16) -> Option<BridgeInfo> {
        self.bridges
            .read()
            .unwrap()
            .values()
            .find(|b| b.port == port)
            .cloned()
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

    pub fn add_permission(&self, perm: PendingPermission) {
        let mut perms = self.pending_permissions.write().unwrap();
        // 같은 request_id가 이미 있으면 교체
        perms.retain(|p| p.request_id != perm.request_id);
        perms.push(perm);
    }

    pub fn remove_permission(&self, request_id: &str) {
        self.pending_permissions
            .write()
            .unwrap()
            .retain(|p| p.request_id != request_id);
    }

    pub fn list_permissions(&self) -> Vec<PendingPermission> {
        self.pending_permissions.read().unwrap().clone()
    }

    // --- DB 헬퍼 ---

    fn db_upsert_session(&self, info: &BridgeInfo) {
        let conn = self.db.lock().unwrap();
        conn.execute(
            "INSERT INTO session (id, session_id, cwd, pid, port, status, last_active)
             VALUES (?1, ?2, ?3, ?4, ?5, 'active', datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                session_id = COALESCE(?2, session.session_id),
                cwd = ?3, pid = ?4, port = ?5,
                status = 'active',
                last_active = datetime('now')",
            rusqlite::params![info.id, info.session_id, info.cwd, info.pid, info.port],
        )
        .ok();
    }

}
