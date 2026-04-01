use tokio::process::Command;

/// Create a new Claude Code session in a tmux window for the given working directory.
/// Returns the tmux session name on success.
pub async fn create_session(cwd: &str) -> anyhow::Result<String> {
    let short_id = &uuid::Uuid::new_v4().to_string()[..8];
    let session_name = format!("claude-{}", short_id);

    let output = Command::new("tmux")
        .args(["new-session", "-d", "-s", &session_name, "-c", cwd])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!(
            "tmux new-session failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    // Start Claude Code with expect to auto-confirm the channel prompt
    let expect_cmd = r#"expect -c '
set timeout 10
spawn claude --dangerously-load-development-channels server:spire
expect "Enter to confirm"
send "\r"
interact
'"#;
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", &session_name, expect_cmd, "Enter"])
        .output()
        .await?;

    Ok(session_name)
}

/// List all active tmux sessions whose names start with "claude-".
pub async fn list_sessions() -> anyhow::Result<Vec<String>> {
    let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .await?;

    let names = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| l.starts_with("claude-"))
        .map(String::from)
        .collect();

    Ok(names)
}
