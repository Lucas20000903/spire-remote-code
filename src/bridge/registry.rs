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
    ) -> String {
        // 1. 메모리에서 같은 pid의 기존 등록 재사용
        {
            let mut bridges = self.bridges.write().unwrap();
            if let Some(existing) = bridges.values_mut().find(|b| b.pid == pid) {
                let id = existing.id.clone();
                existing.port = port;
                existing.cwd = cwd.clone();
                existing.registered_at = chrono::Utc::now();
                if session_id.is_some() {
                    existing.session_id = session_id.clone();
                }
                let info = existing.clone();
                tracing::info!("bridge reused (memory): {} (pid={}, port={})", id, pid, port);
                self.db_upsert_session(&info);
                let _ = self.event_tx.send(BridgeEvent::Registered(info));
                return id;
            }
        }

        // 2. DB에서 같은 cwd+pid로 이전 세션 복원 시도
        let restored = self.db_find_session(pid, &cwd);
        if let Some((old_bridge_id, old_session_id)) = restored {
            tracing::info!(
                "bridge restored (db): {} (pid={}, cwd={}, session={:?})",
                old_bridge_id, pid, cwd, old_session_id
            );
            let merged_session = session_id.or(old_session_id);
            let info = BridgeInfo {
                id: old_bridge_id.clone(),
                port,
                session_id: merged_session,
                cwd,
                pid,
                registered_at: chrono::Utc::now(),
            };
            self.bridges
                .write()
                .unwrap()
                .insert(old_bridge_id.clone(), info.clone());
            self.message_queues
                .write()
                .unwrap()
                .insert(old_bridge_id.clone(), Vec::new());
            self.db_upsert_session(&info);
            let _ = self.event_tx.send(BridgeEvent::Registered(info));
            return old_bridge_id;
        }

        // 3. 완전히 새로운 등록
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
        self.db_upsert_session(&info);
        let _ = self.event_tx.send(BridgeEvent::Registered(info));
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

    /// DB에서 cwd+pid로 이전 세션 찾기 (서버 재시작 후 복원용)
    fn db_find_session(&self, pid: u32, cwd: &str) -> Option<(String, Option<String>)> {
        let conn = self.db.lock().unwrap();
        conn.query_row(
            "SELECT id, session_id FROM session
             WHERE pid = ?1 AND cwd = ?2
             ORDER BY last_active DESC LIMIT 1",
            rusqlite::params![pid, cwd],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .ok()
    }
}
