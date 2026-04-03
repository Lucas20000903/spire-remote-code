use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;

const PREFS_FILE: &str = ".spire/preferences.toml";

struct Preferences {
    use_tmux: bool,
    skip_permissions: bool,
    bridge_path: Option<String>,
    port: u16,
    repo_path: Option<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            use_tmux: false,
            skip_permissions: false,
            bridge_path: None,
            port: 3000,
            repo_path: None,
        }
    }
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
        } else if line.starts_with("port") {
            if let Some(val) = line.split('=').nth(1) {
                if let Ok(p) = val.trim().parse::<u16>() {
                    prefs.port = p;
                }
            }
        } else if line.starts_with("repo_path") {
            if let Some(val) = line.split('=').nth(1) {
                let val = val.trim().trim_matches('"').trim_matches('\'');
                if !val.is_empty() {
                    prefs.repo_path = Some(val.to_string());
                }
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
        "use_tmux = {}\nskip_permissions = {}\nbridge_path = \"{}\"\nport = {}\nrepo_path = \"{}\"\n",
        prefs.use_tmux,
        prefs.skip_permissions,
        prefs.bridge_path.as_deref().unwrap_or(""),
        prefs.port,
        prefs.repo_path.as_deref().unwrap_or(""),
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

    let claude_cmd = args.join(" ");

    if prefs.use_tmux {
        let session_name = format!("spire_{}", &uuid::Uuid::new_v4().to_string()[..8]);
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
    println!("\n  Spire Setup\n");

    // 1. Bridge path
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

    // 4. port
    let port_str = ask_string("Server port", "3000");
    let port: u16 = port_str.parse().unwrap_or(3000);

    // Save preferences
    let prefs = Preferences {
        use_tmux,
        skip_permissions,
        bridge_path: Some(bridge_abs.to_string_lossy().to_string()),
        port,
        repo_path: None,
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
            register_mcp(&bridge_str, port);
        }
    } else {
        register_mcp(&bridge_str, port);
    }

    println!("\n🎉 Setup complete!");
    println!("\nUsage:");
    println!("  spire        — Start the web server");
    println!("  spire cc     — Launch Claude Code with Spire");
    println!("  spire setup  — Re-run this setup\n");
}

fn register_mcp(bridge_str: &str, port: u16) {
    println!("\nRegistering MCP server...");
    // Remove existing first (ignore errors)
    let _ = Command::new("claude")
        .args(["mcp", "remove", "-s", "user", "spire"])
        .output();
    let env_arg = format!("BRIDGE_RUST_SERVER=http://localhost:{}", port);
    let status = Command::new("claude")
        .args([
            "mcp", "add", "-s", "user", "spire",
            "-e", &env_arg,
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

const PLIST_LABEL: &str = "com.spire.server";

fn plist_path() -> PathBuf {
    dirs::home_dir()
        .expect("home dir")
        .join(format!("Library/LaunchAgents/{}.plist", PLIST_LABEL))
}

fn launchctl_uid() -> String {
    let uid = Command::new("id").arg("-u").output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "501".to_string());
    format!("gui/{}", uid)
}

pub fn service_stop() {
    let domain = format!("{}/{}", launchctl_uid(), PLIST_LABEL);
    let status = Command::new("launchctl")
        .args(["bootout", &domain])
        .status();
    match status {
        Ok(s) if s.success() => println!("Spire stopped."),
        _ => eprintln!("Spire is not running."),
    }
}

pub fn service_start() {
    let plist = plist_path();
    if !plist.exists() {
        eprintln!("LaunchAgent not installed. Run install.sh first.");
        return;
    }
    let domain = launchctl_uid();
    let status = Command::new("launchctl")
        .args(["bootstrap", &domain, &plist.to_string_lossy()])
        .status();
    match status {
        Ok(s) if s.success() => println!("Spire started."),
        _ => eprintln!("Failed to start. Already running?"),
    }
}

pub fn service_restart() {
    let domain_label = format!("{}/{}", launchctl_uid(), PLIST_LABEL);
    let _ = Command::new("launchctl")
        .args(["bootout", &domain_label])
        .status();
    let plist = plist_path();
    if !plist.exists() {
        eprintln!("LaunchAgent not installed. Run install.sh first.");
        return;
    }
    let domain = launchctl_uid();
    let status = Command::new("launchctl")
        .args(["bootstrap", &domain, &plist.to_string_lossy()])
        .status();
    match status {
        Ok(s) if s.success() => println!("Spire restarted."),
        _ => eprintln!("Failed to restart."),
    }
}

pub fn service_status() {
    let domain_label = format!("{}/{}", launchctl_uid(), PLIST_LABEL);
    let output = Command::new("launchctl")
        .args(["print", &domain_label])
        .output();
    match output {
        Ok(o) if o.status.success() => {
            let out = String::from_utf8_lossy(&o.stdout);
            let pid = out.lines()
                .find(|l| l.contains("pid ="))
                .and_then(|l| l.split('=').nth(1))
                .map(|s| s.trim().to_string());
            let prefs = load_prefs();
            println!("Spire is running.");
            if let Some(pid) = pid {
                println!("  PID:  {}", pid);
            }
            println!("  Port: {}", prefs.port);
            println!("  URL:  http://localhost:{}", prefs.port);
        }
        _ => println!("Spire is not running."),
    }
}

pub fn service_rebuild() {
    // Find repo root (where Cargo.toml is)
    let repo = find_repo_root();
    let Some(repo) = repo else {
        eprintln!("Cannot find project root (Cargo.toml). Run from the repo directory or run 'spire setup' first.");
        return;
    };

    // repo 경로 저장 (다음번엔 어디서든 rebuild 가능)
    let mut prefs = load_prefs();
    let repo_str = repo.to_string_lossy().to_string();
    if prefs.repo_path.as_deref() != Some(&repo_str) {
        prefs.repo_path = Some(repo_str);
        save_prefs(&prefs);
    }

    let data_dir = dirs::home_dir().unwrap().join(".spire");
    let install_dir = dirs::home_dir().unwrap().join(".local/bin");

    // 1. Build Rust
    println!("[1/3] Building server...");
    let status = Command::new("cargo")
        .args(["build", "--release"])
        .current_dir(&repo)
        .env("RUSTFLAGS", "-A warnings")
        .status();
    if !matches!(status, Ok(s) if s.success()) {
        eprintln!("Rust build failed.");
        return;
    }

    // 2. Build frontend
    println!("[2/3] Building frontend...");
    let status = Command::new("pnpm")
        .args(["build"])
        .current_dir(repo.join("web"))
        .status();
    if !matches!(status, Ok(s) if s.success()) {
        eprintln!("Frontend build failed.");
        return;
    }

    // 3. Copy
    println!("[3/3] Installing...");
    std::fs::create_dir_all(&install_dir).ok();
    std::fs::create_dir_all(data_dir.join("web")).ok();
    let _ = std::fs::copy(repo.join("target/release/spire"), install_dir.join("spire"));
    // Copy web/dist contents
    if let Ok(entries) = std::fs::read_dir(repo.join("web/dist")) {
        for entry in entries.flatten() {
            let dest = data_dir.join("web").join(entry.file_name());
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                copy_dir_all(&entry.path(), &dest).ok();
            } else {
                std::fs::copy(entry.path(), dest).ok();
            }
        }
    }

    // Restart
    service_restart();
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

fn find_repo_root() -> Option<PathBuf> {
    // 1. Check cwd and parents for Cargo.toml with name = "spire"
    if let Ok(mut dir) = std::env::current_dir() {
        loop {
            if dir.join("Cargo.toml").exists() {
                if let Ok(content) = std::fs::read_to_string(dir.join("Cargo.toml")) {
                    if content.contains("name = \"spire\"") {
                        return Some(dir);
                    }
                }
            }
            if !dir.pop() { break; }
        }
    }
    // 2. Fallback: saved repo_path in preferences
    let prefs = load_prefs();
    if let Some(ref p) = prefs.repo_path {
        let dir = PathBuf::from(p);
        if dir.join("Cargo.toml").exists() {
            return Some(dir);
        }
    }

    // Check relative to executable
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    for dir in [exe_dir, exe_dir.parent()?, exe_dir.parent()?.parent()?] {
        if dir.join("Cargo.toml").exists() {
            return Some(dir.to_path_buf());
        }
    }

    None
}

/// `spire dev` — cargo-watch (프로덕션 포트) + Vite dev server (자동 포트) 동시 실행
pub fn dev_server() {
    let repo = find_repo_root();
    let Some(repo) = repo else {
        eprintln!("Cannot find project root (Cargo.toml). Run from the repo directory.");
        std::process::exit(1);
    };

    // cargo-watch 설치 여부 확인
    let has_cargo_watch = Command::new("cargo")
        .args(["watch", "--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !has_cargo_watch {
        eprintln!("cargo-watch is required for 'spire dev'.");
        eprintln!("Install with: cargo install cargo-watch");
        std::process::exit(1);
    }

    let prefs = load_prefs();
    let port = prefs.port;

    // 프로덕션 서버가 실행 중이면 중지
    let prod_was_running = is_service_running();
    if prod_was_running {
        println!("  Stopping production server...");
        service_stop();
        // 포트 해제 대기
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    println!("\n  Spire Dev Mode\n");
    println!("  Backend  : http://localhost:{}  (cargo-watch)", port);
    println!("  Frontend : Vite HMR (auto port, see output below)");
    println!("  Bridge connects to port {} as usual\n", port);

    // Rust server (cargo-watch, 프로덕션과 같은 포트, STATIC_DIR 없음)
    let run_arg = format!("run -- -p {}", port);
    let mut rust_proc = Command::new("cargo")
        .args(["watch", "-x", &run_arg])
        .current_dir(&repo)
        .env_remove("STATIC_DIR")
        .spawn()
        .expect("failed to start cargo-watch");

    // Vite dev server (자동 포트 할당)
    let proxy_target = format!("http://localhost:{}", port);
    let ws_target = format!("ws://localhost:{}", port);
    let mut vite_proc = Command::new("pnpm")
        .args(["dev"])
        .current_dir(repo.join("web"))
        .env("VITE_API_TARGET", &proxy_target)
        .env("VITE_WS_TARGET", &ws_target)
        .spawn()
        .expect("failed to start Vite dev server");

    // 하나라도 종료되면 다른 것도 종료
    let rust_id = rust_proc.id();
    let vite_id = vite_proc.id();

    // Ctrl+C 핸들링: 두 프로세스 모두 종료
    let (tx, rx) = std::sync::mpsc::channel();
    ctrlc_channel(tx);

    loop {
        // Ctrl+C 수신 확인
        if rx.try_recv().is_ok() {
            kill_proc(rust_id);
            kill_proc(vite_id);
            let _ = rust_proc.wait();
            let _ = vite_proc.wait();
            // 프로덕션 서버 복구
            if prod_was_running {
                println!("  Restarting production server...");
                service_start();
            }
            println!("\n  Dev server stopped.");
            break;
        }

        // 자식 프로세스 종료 확인
        if let Ok(Some(_)) = rust_proc.try_wait() {
            eprintln!("cargo-watch exited unexpectedly.");
            kill_proc(vite_id);
            let _ = vite_proc.wait();
            if prod_was_running {
                service_start();
            }
            break;
        }
        if let Ok(Some(_)) = vite_proc.try_wait() {
            eprintln!("Vite dev server exited unexpectedly.");
            kill_proc(rust_id);
            let _ = rust_proc.wait();
            if prod_was_running {
                service_start();
            }
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn is_service_running() -> bool {
    let domain_label = format!("{}/{}", launchctl_uid(), PLIST_LABEL);
    Command::new("launchctl")
        .args(["print", &domain_label])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn ctrlc_channel(tx: std::sync::mpsc::Sender<()>) {
    std::thread::spawn(move || {
        // SIGINT/SIGTERM 대기 (간단한 방식)
        let (sig_tx, sig_rx) = std::sync::mpsc::channel();
        let _ = unsafe {
            libc::signal(libc::SIGINT, signal_handler as *const () as libc::sighandler_t);
            libc::signal(libc::SIGTERM, signal_handler as *const () as libc::sighandler_t);
        };
        // static channel로 시그널 전달
        SIGNAL_TX.lock().unwrap().replace(sig_tx);
        if sig_rx.recv().is_ok() {
            let _ = tx.send(());
        }
    });
}

static SIGNAL_TX: std::sync::Mutex<Option<std::sync::mpsc::Sender<()>>> =
    std::sync::Mutex::new(None);

extern "C" fn signal_handler(_: libc::c_int) {
    if let Some(tx) = SIGNAL_TX.lock().ok().and_then(|g| g.as_ref().cloned()) {
        let _ = tx.send(());
    }
}

fn kill_proc(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
}

/// `spire hook` — stdin에서 hook JSON을 읽고 Rust 서버에 POST
pub fn handle_hook() {
    let input = {
        let mut buf = String::new();
        if io::stdin().read_line(&mut buf).is_err() || buf.trim().is_empty() {
            // stdin에서 한 줄만 읽으면 안 되고 전체를 읽어야 함
            buf.clear();
        }
        // 전체 stdin 읽기
        if buf.is_empty() {
            let mut full = String::new();
            io::Read::read_to_string(&mut io::stdin(), &mut full).ok();
            full
        } else {
            // 첫 줄 이후 나머지도 읽기
            let mut rest = String::new();
            io::Read::read_to_string(&mut io::stdin(), &mut rest).ok();
            format!("{}{}", buf, rest)
        }
    };

    let input = input.trim();
    if input.is_empty() {
        return;
    }

    // JSON 파싱 + tmux 세션 이름 주입
    let mut json: serde_json::Value = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(_) => return,
    };

    // 현재 tmux 세션 이름 감지 (Hook은 Claude 내부에서 실행되므로 정확)
    if let Ok(output) = std::process::Command::new("tmux")
        .args(["display", "-p", "#{session_name}"])
        .output()
    {
        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                json["tmux_session"] = serde_json::Value::String(name);
            }
        }
    }

    let prefs = load_prefs();
    let url = format!("http://localhost:{}/api/hooks/event", prefs.port);

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build();

    if let Ok(client) = client {
        let _ = client
            .post(&url)
            .header("Content-Type", "application/json")
            .body(json.to_string())
            .send();
    }
}

fn find_bridge_path() -> Option<String> {
    // Check installed location (~/.spire/bridge/bridge.ts)
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".spire/bridge/bridge.ts");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    // Check relative to cwd
    let cwd = std::env::current_dir().ok()?;
    let candidate = cwd.join("bridge/bridge.ts");
    if candidate.exists() {
        return Some(candidate.to_string_lossy().to_string());
    }

    // Check relative to executable
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    for dir in [exe_dir, exe_dir.parent()?, exe_dir.parent()?.parent()?] {
        let candidate = dir.join("bridge/bridge.ts");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}
