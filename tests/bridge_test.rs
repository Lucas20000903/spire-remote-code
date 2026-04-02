use spire::bridge::registry::BridgeRegistry;

#[test]
fn test_register_and_lookup() {
    let registry = BridgeRegistry::new();
    let id = registry.register(8801, None, "/workspace/project".into(), 1234);
    let bridge = registry.get(&id).unwrap();
    assert_eq!(bridge.port, 8801);
    assert_eq!(bridge.cwd, "/workspace/project");
    assert!(bridge.session_id.is_none());
}

#[test]
fn test_update_session_id() {
    let registry = BridgeRegistry::new();
    let id = registry.register(8801, None, "/workspace".into(), 1234);
    registry.update_session(&id, "ses-123".into());
    let bridge = registry.get(&id).unwrap();
    assert_eq!(bridge.session_id.as_deref(), Some("ses-123"));
}

#[test]
fn test_unregister_on_drop() {
    let registry = BridgeRegistry::new();
    let id = registry.register(8801, None, "/workspace".into(), 1234);
    registry.unregister(&id);
    assert!(registry.get(&id).is_none());
}

#[test]
fn test_list_active() {
    let registry = BridgeRegistry::new();
    registry.register(8801, None, "/a".into(), 1);
    registry.register(8802, None, "/b".into(), 2);
    assert_eq!(registry.list_active().len(), 2);
}
