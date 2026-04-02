use spire::jsonl::parser::{parse_entry, ContentBlock};

#[test]
fn test_parse_text_message() {
    let line = r#"{"uuid":"u1","parentUuid":"u0","sessionId":"s1","timestamp":"2026-04-01T00:00:00Z","type":"user","message":{"role":"user","content":"hello"}}"#;
    let entry = parse_entry(line).unwrap();
    assert_eq!(entry.session_id, "s1");
    assert_eq!(entry.entry_type, "user");
}

#[test]
fn test_parse_assistant_with_blocks() {
    let line = r#"{"uuid":"u2","parentUuid":"u1","sessionId":"s1","timestamp":"2026-04-01T00:01:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"reasoning..."},{"type":"text","text":"answer"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#;
    let entry = parse_entry(line).unwrap();
    let message = entry.message.expect("should have message");
    match &message.content {
        spire::jsonl::parser::Content::Blocks(blocks) => {
            assert_eq!(blocks.len(), 3);
            assert!(matches!(blocks[0], ContentBlock::Thinking { .. }));
            assert!(matches!(blocks[1], ContentBlock::Text { .. }));
            assert!(matches!(blocks[2], ContentBlock::ToolUse { .. }));
        }
        _ => panic!("expected blocks"),
    }
}

#[test]
fn test_parse_system_entry_no_message() {
    let line = r#"{"uuid":"u3","type":"system","subtype":"compact","timestamp":"2026-04-01T00:00:00Z","isMeta":true}"#;
    let entry = parse_entry(line).unwrap();
    assert_eq!(entry.entry_type, "system");
    assert!(entry.message.is_none());
    assert!(!entry.is_conversation());
}

#[test]
fn test_parse_file_history_snapshot() {
    let line = r#"{"type":"file-history-snapshot","messageId":"abc","snapshot":{},"isSnapshotUpdate":false}"#;
    let entry = parse_entry(line).unwrap();
    assert_eq!(entry.entry_type, "file-history-snapshot");
    assert!(!entry.is_conversation());
}

#[test]
fn test_cwd_to_mangled_path() {
    use spire::jsonl::parser::cwd_to_project_dir;
    let result = cwd_to_project_dir("/Users/lucas/workspace/mango-renewal-fe");
    assert_eq!(result, "-Users-lucas-workspace-mango-renewal-fe");
}
