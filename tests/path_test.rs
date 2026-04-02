use spire::jsonl::parser::{project_dir_to_cwd, cwd_to_project_dir};

#[test]
fn test_roundtrip_hyphenated_path() {
    let cwd = "/Users/lucas/workspace/claude-code-remote";
    let dir = cwd_to_project_dir(cwd);
    assert_eq!(dir, "-Users-lucas-workspace-claude-code-remote");
    let decoded = project_dir_to_cwd(&dir).unwrap();
    assert_eq!(decoded, cwd);
}

#[test]
fn test_roundtrip_simple_path() {
    let cwd = "/Users/lucas/workspace/spire";
    let dir = cwd_to_project_dir(cwd);
    let decoded = project_dir_to_cwd(&dir).unwrap();
    assert_eq!(decoded, cwd);
}
