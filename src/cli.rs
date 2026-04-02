use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;

const PREFS_FILE: &str = ".spire/preferences.toml";

#[derive(Default)]
struct Preferences {
    use_tmux: bool,
    skip_permissions: bool,
    bridge_path: Option<String>,
}

fn prefs_path() -> PathBuf {
    dirs::home_dir()
        .expect("home dir")
        .join(PREFS_FILE)
}

fn load_prefs() -> Preferences {
    let path = prefs_path();
    if !path.exists() {
        return Preferences::default();
    }
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let mut prefs = Preferences::default();
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("use_tmux") {
            prefs.use_tmux = line.contains("true");
        } else if line.starts_with("skip_permissions") {
            prefs.skip_permissions = line.contains("true");
        } else if line.starts_with("bridge_path") {
            if let Some(val) = line.split('=').nth(1) {
                let val = val.trim().trim_matches('"').trim_matches('\'');
                prefs.bridge_path = Some(val.to_string());
            }
        }
    }
    prefs
}

fn save_prefs(prefs: &Preferences) {
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let content = format!(
        "use_tmux = {}\nskip_permissions = {}\nbridge_path = \"{}\"\n",
        prefs.use_tmux,
        prefs.skip_permissions,
        prefs.bridge_path.as_deref().unwrap_or(""),
    );
    std::fs::write(&path, content).expect("failed to write preferences");
}

fn ask_yn(prompt: &str, default: bool) -> bool {
    let suffix = if default { "[Y/n]" } else { "[y/N]" };
    print!("{} {} ", prompt, suffix);
    io::stdout().flush().unwrap();
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let input = input.trim().to_lowercase();
    if input.is_empty() {
        return default;
    }
    input.starts_with('y')
}

fn ask_string(prompt: &str, default: &str) -> String {
    print!("{} [{}]: ", prompt, default);
    io::stdout().flush().unwrap();
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let input = input.trim();
    if input.is_empty() {
        default.to_string()
    } else {
        input.to_string()
    }
}

/// `spire cc` — Launch Claude Code with channel flags
pub fn launch_cc() {
    let prefs = load_prefs();

    if prefs.bridge_path.as_deref().unwrap_or("").is_empty() {
        eprintln!("Bridge not configured. Run 'spire setup' first.");
        std::process::exit(1);
    }

    let mut args = vec![
        "claude".to_string(),
        "--dangerously-load-development-channels".to_string(),
        "server:spire".to_string(),
    ];

    if prefs.skip_permissions {
        args.push("--dangerously-skip-permissions".to_string());
    }

    if prefs.use_tmux {
        let session_name = format!("spire_{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let claude_cmd = args.join(" ");
        let status = Command::new("tmux")
            .args(["new-session", "-d", "-s", &session_name, &claude_cmd])
            .status();

        match status {
            Ok(s) if s.success() => {
                println!("Started Claude Code in tmux session: {}", session_name);
                println!("Attach with: tmux attach -t {}", session_name);
            }
            _ => {
                eprintln!("Failed to create tmux session. Is tmux installed?");
                std::process::exit(1);
            }
        }
    } else {
        let status = Command::new(&args[0])
            .args(&args[1..])
            .status();

        match status {
            Ok(s) => std::process::exit(s.code().unwrap_or(1)),
            Err(e) => {
                eprintln!("Failed to launch Claude Code: {}", e);
                std::process::exit(1);
            }
        }
    }
}

/// `spire setup` — Interactive setup
pub fn run_setup() {
    println!("\n  ⛰️  Spire Setup\n");

    // 1. Bridge path
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();

    // Try to find bridge.ts relative to executable or cwd
    let default_bridge = find_bridge_path()
        .unwrap_or_else(|| "bridge/bridge.ts".to_string());

    let bridge_path = ask_string("Bridge path", &default_bridge);

    // Resolve to absolute path
    let bridge_abs = std::fs::canonicalize(&bridge_path)
        .unwrap_or_else(|_| PathBuf::from(&bridge_path));

    if !bridge_abs.exists() {
        eprintln!("Warning: Bridge file not found at {}", bridge_abs.display());
    }

    // 2. tmux (기본값: tmux 설치되어 있으면 Y)
    let tmux_available = Command::new("tmux").arg("-V").output().map(|o| o.status.success()).unwrap_or(false);
    let use_tmux = ask_yn("Run Claude Code inside tmux sessions?", tmux_available);

    // 3. skip permissions
    let skip_permissions = ask_yn("Skip permission prompts? (--dangerously-skip-permissions)", false);

    // Save preferences
    let prefs = Preferences {
        use_tmux,
        skip_permissions,
        bridge_path: Some(bridge_abs.to_string_lossy().to_string()),
    };
    save_prefs(&prefs);
    println!("\n✓ Preferences saved to {}", prefs_path().display());

    // 4. Register MCP server
    let bridge_str = bridge_abs.to_string_lossy();

    // Check if already registered
    let existing = Command::new("claude")
        .args(["mcp", "list"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();

    if existing.contains("spire") {
        let re_register = ask_yn("MCP server 'spire' is already registered. Re-register?", false);
        if !re_register {
            println!("✓ Keeping existing MCP registration");
        } else {
            register_mcp(&bridge_str);
        }
    } else {
        register_mcp(&bridge_str);
    }

    println!("\n🎉 Setup complete!");
    println!("\nUsage:");
    println!("  spire        — Start the web server");
    println!("  spire cc     — Launch Claude Code with Spire");
    println!("  spire setup  — Re-run this setup\n");
}

fn register_mcp(bridge_str: &str) {
    println!("\nRegistering MCP server...");
    let status = Command::new("claude")
        .args([
            "mcp", "add", "-s", "user", "spire",
            "npx", "tsx", bridge_str,
        ])
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("✓ MCP server 'spire' registered");
        }
        Ok(_) => {
            eprintln!("✗ Failed to register MCP server. You can do it manually:");
            eprintln!("  claude mcp add -s user spire npx tsx {}", bridge_str);
        }
        Err(_) => {
            eprintln!("✗ 'claude' command not found. Install Claude Code first.");
            eprintln!("  Then run: claude mcp add -s user spire npx tsx {}", bridge_str);
        }
    }
}

fn find_bridge_path() -> Option<String> {
    // Check relative to cwd
    let cwd = std::env::current_dir().ok()?;
    let candidate = cwd.join("bridge/bridge.ts");
    if candidate.exists() {
        return Some(candidate.to_string_lossy().to_string());
    }

    // Check relative to executable
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    // executable might be in target/release, go up
    for dir in [exe_dir, exe_dir.parent()?, exe_dir.parent()?.parent()?] {
        let candidate = dir.join("bridge/bridge.ts");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}
