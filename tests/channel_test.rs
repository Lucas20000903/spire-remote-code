use spire::jsonl::parser::parse_entry;

#[test]
fn test_null_parent_uuid() {
    let line = r#"{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"hello"},"uuid":"5e4bb1ad","timestamp":"2026-04-01T20:43:13.648Z","cwd":"/test","sessionId":"74ad9235"}"#;
    let entry = parse_entry(line).unwrap();
    assert_eq!(entry.entry_type, "user");
    assert!(entry.is_conversation());
    assert!(!entry.is_sidechain);
    assert_eq!(entry.parent_uuid, "");
}
