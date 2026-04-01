/// Create a new Claude Code session in a tmux window for the given working directory.
/// Returns the tmux session name on success.
///
/// TODO(Task 6): Full implementation with tmux process management.
pub async fn create_session(cwd: &str) -> anyhow::Result<String> {
    let session_name = format!(
        "claude-{}",
        &uuid::Uuid::new_v4().to_string()[..8]
    );

    let status = tokio::process::Command::new("tmux")
        .args(["new-session", "-d", "-s", &session_name, "-c", cwd])
        .status()
        .await?;

    if status.success() {
        Ok(session_name)
    } else {
        anyhow::bail!("tmux new-session failed with status {}", status)
    }
}
