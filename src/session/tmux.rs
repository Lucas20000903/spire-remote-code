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

    // Send "claude" command to start Claude Code inside the tmux session.
    // The alias is expected to include any channel flags.
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", &session_name, "claude", "Enter"])
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
