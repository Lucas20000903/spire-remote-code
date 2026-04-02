#!/bin/bash
set -e

PLIST_NAME="com.spire.claude-code-remote"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
INSTALL_DIR="$HOME/.local/bin"
DATA_DIR="$HOME/.claude-code-remote"

echo "=== Spire (Claude Code Remote) 제거 ==="

# 서비스 중지
launchctl bootout "gui/$(id -u)/${PLIST_NAME}" 2>/dev/null || true
rm -f "$PLIST_PATH"
echo "  LaunchAgent 제거됨"

# 바이너리 제거
rm -f "$INSTALL_DIR/claude-code-remote"
echo "  바이너리 제거됨"

# 데이터 제거 확인
read -p "  데이터도 삭제할까요? ($DATA_DIR) [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$DATA_DIR"
    echo "  데이터 삭제됨"
else
    echo "  데이터 유지됨"
fi

echo ""
echo "=== 제거 완료 ==="
