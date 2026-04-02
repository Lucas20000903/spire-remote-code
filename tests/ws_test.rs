use spire::ws::hub::WsHub;

#[tokio::test]
async fn test_subscribe_and_broadcast() {
    let hub = WsHub::new();
    let mut rx = hub.subscribe_session("ses-1").await;
    hub.broadcast_to_session("ses-1", r#"{"type":"test"}"#.into())
        .await;
    let msg = rx.recv().await.unwrap();
    assert!(msg.contains("test"));
}

#[tokio::test]
async fn test_broadcast_all() {
    let hub = WsHub::new();
    let mut rx = hub.subscribe_global();
    hub.broadcast_all(r#"{"type":"session_registered"}"#.into())
        .await;
    let msg = rx.recv().await.unwrap();
    assert!(msg.contains("session_registered"));
}
