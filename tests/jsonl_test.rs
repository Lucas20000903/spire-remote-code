use claude_code_remote::jsonl::parser::{parse_entry, ContentBlock};

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
    match &entry.message.content {
        claude_code_remote::jsonl::parser::Content::Blocks(blocks) => {
            assert_eq!(blocks.len(), 3);
            assert!(matches!(blocks[0], ContentBlock::Thinking { .. }));
            assert!(matches!(blocks[1], ContentBlock::Text { .. }));
            assert!(matches!(blocks[2], ContentBlock::ToolUse { .. }));
        }
        _ => panic!("expected blocks"),
    }
}

#[test]
fn test_cwd_to_mangled_path() {
    use claude_code_remote::jsonl::parser::cwd_to_project_dir;
    let result = cwd_to_project_dir("/Users/lucas/workspace/mango-renewal-fe");
    assert_eq!(result, "-Users-lucas-workspace-mango-renewal-fe");
}
