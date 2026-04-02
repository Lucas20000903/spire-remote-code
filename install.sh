#!/bin/sh
set -e

REPO="Lucas20000903/spire-remote-code"
INSTALL_DIR="${SPIRE_INSTALL_DIR:-/usr/local/bin}"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
  darwin|linux) ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

NAME="spire-${OS}-${ARCH}"

# Get latest version
if command -v curl >/dev/null 2>&1; then
  LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')
elif command -v wget >/dev/null 2>&1; then
  LATEST=$(wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')
else
  echo "curl or wget is required"
  exit 1
fi

if [ -z "$LATEST" ]; then
  echo "Failed to fetch latest version"
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${LATEST}/${NAME}.tar.gz"

echo "Installing spire ${LATEST} for ${OS}-${ARCH}..."

# Download and extract
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" | tar xz -C "$TMPDIR"
else
  wget -qO- "$URL" | tar xz -C "$TMPDIR"
fi

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPDIR/$NAME" "$INSTALL_DIR/spire"
else
  sudo mv "$TMPDIR/$NAME" "$INSTALL_DIR/spire"
fi
chmod +x "$INSTALL_DIR/spire"

echo "spire ${LATEST} installed to ${INSTALL_DIR}/spire"
echo ""
echo "Run 'spire --help' to get started."
