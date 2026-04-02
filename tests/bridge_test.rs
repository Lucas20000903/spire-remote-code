use spire::bridge::registry::BridgeRegistry;
use spire::db;
use std::path::PathBuf;

fn test_db() -> spire::db::DbPool {
    db::init_db(&PathBuf::from(":memory:")).unwrap()
}

#[test]
fn test_register_and_lookup() {
    let registry = BridgeRegistry::new(test_db());
    let id = registry.register(8801, None, "/workspace/project".into(), 1234);
    let bridge = registry.get(&id).unwrap();
    assert_eq!(bridge.port, 8801);
    assert_eq!(bridge.cwd, "/workspace/project");
    assert!(bridge.session_id.is_none());
}

#[test]
fn test_update_session_id() {
    let registry = BridgeRegistry::new(test_db());
    let id = registry.register(8801, None, "/workspace".into(), 1234);
    registry.update_session(&id, "ses-123".into());
    let bridge = registry.get(&id).unwrap();
    assert_eq!(bridge.session_id.as_deref(), Some("ses-123"));
}

#[test]
fn test_unregister_on_drop() {
    let registry = BridgeRegistry::new(test_db());
    let id = registry.register(8801, None, "/workspace".into(), 1234);
    registry.unregister(&id);
    assert!(registry.get(&id).is_none());
}

#[test]
fn test_list_active() {
    let registry = BridgeRegistry::new(test_db());
    registry.register(8801, None, "/a".into(), 1);
    registry.register(8802, None, "/b".into(), 2);
    assert_eq!(registry.list_active().len(), 2);
}

#[test]
fn test_session_restored_from_db_after_restart() {
    let db = test_db();

    // 첫 번째 서버 인스턴스: bridge 등록 + session_id 설정
    let id = {
        let registry = BridgeRegistry::new(db.clone());
        let id = registry.register(8801, None, "/workspace/project".into(), 5555);
        registry.update_session(&id, "ses-abc".into());
        id
    };
    // registry가 drop됨 (서버 재시작 시뮬레이션)

    // 두 번째 서버 인스턴스: 같은 DB로 새 registry 생성
    let registry2 = BridgeRegistry::new(db);
    // Bridge가 같은 pid+cwd로 재등록
    let id2 = registry2.register(8802, None, "/workspace/project".into(), 5555);

    // 기존 bridge_id와 session_id가 복원되어야 함
    assert_eq!(id2, id);
    let bridge = registry2.get(&id2).unwrap();
    assert_eq!(bridge.session_id.as_deref(), Some("ses-abc"));
    assert_eq!(bridge.port, 8802); // 새 port로 업데이트됨
}
