#!/bin/bash
set -e

APP_NAME="claude-code-remote"
INSTALL_DIR="$HOME/.local/bin"
DATA_DIR="$HOME/.claude-code-remote"
PLIST_NAME="com.spire.claude-code-remote"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Spire (Claude Code Remote) 설치 ==="

# 1. Rust 서버 빌드
echo "[1/5] Rust 서버 빌드 중..."
cd "$REPO_DIR"
cargo build --release

# 2. 프론트엔드 빌드
echo "[2/5] 프론트엔드 빌드 중..."
cd "$REPO_DIR/web"
pnpm install --frozen-lockfile
pnpm build

# 3. Bridge 의존성
echo "[3/5] Bridge 의존성 설치 중..."
cd "$REPO_DIR/bridge"
bun install

# 4. 바이너리 + 에셋 설치
echo "[4/5] 설치 중..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$DATA_DIR/web"
mkdir -p "$DATA_DIR/bridge"

cp "$REPO_DIR/target/release/$APP_NAME" "$INSTALL_DIR/$APP_NAME"
cp -r "$REPO_DIR/web/dist/"* "$DATA_DIR/web/"
cp -r "$REPO_DIR/bridge/"* "$DATA_DIR/bridge/"
cp "$REPO_DIR/.mcp.json" "$DATA_DIR/.mcp.json"

# 5. LaunchAgent 등록
echo "[5/5] LaunchAgent 등록 중..."

# 기존 서비스 중지
launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${INSTALL_DIR}/${APP_NAME}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>STATIC_DIR</key>
        <string>${DATA_DIR}/web</string>
        <key>PORT</key>
        <string>3000</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${DATA_DIR}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${DATA_DIR}/stderr.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo ""
echo "=== 설치 완료 ==="
echo ""
echo "  서버: http://localhost:3000"
echo "  로그: $DATA_DIR/stdout.log"
echo "  데이터: $DATA_DIR/data.db"
echo ""
echo "  셸에 다음을 추가하세요 (~/.zshrc):"
echo ""
echo '  claude() {'
echo '    if [ -z "$TMUX" ]; then'
echo '      local session_name="claude_$(uuidgen | cut -c1-8)"'
echo '      tmux new-session -s "$session_name" "command claude --dangerously-load-development-channels server:spire $*"'
echo '    else'
echo '      command claude --dangerously-load-development-channels server:spire "\$@"'
echo '    fi'
echo '  }'
echo ""
echo "  관리 명령어:"
echo "    서비스 중지:  launchctl bootout gui/$(id -u) $PLIST_PATH"
echo "    서비스 시작:  launchctl bootstrap gui/$(id -u) $PLIST_PATH"
echo "    인증 초기화:  $INSTALL_DIR/$APP_NAME reset-auth"
