const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const REPO = 'Lucas20000903/spire-remote-code';
const BIN_DIR = path.join(__dirname, 'bin');
const BIN_PATH = path.join(BIN_DIR, 'spire');

const PLATFORM_MAP = {
  'darwin-arm64': 'spire-darwin-arm64',
  'darwin-x64': 'spire-darwin-x64',
  'linux-x64': 'spire-linux-x64',
  'linux-arm64': 'spire-linux-arm64',
};

function getPlatformKey() {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}

function getVersion() {
  const pkg = require('./package.json');
  return pkg.version;
}

function download(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'spire-installer' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const key = getPlatformKey();
  const name = PLATFORM_MAP[key];
  if (!name) {
    console.error(`Unsupported platform: ${key}`);
    console.error(`Supported: ${Object.keys(PLATFORM_MAP).join(', ')}`);
    process.exit(1);
  }

  const version = getVersion();
  const url = `https://github.com/${REPO}/releases/download/v${version}/${name}.tar.gz`;

  console.log(`Downloading spire v${version} for ${key}...`);

  try {
    const tarball = await download(url);

    // Write tarball to temp file and extract
    const tmpFile = path.join(__dirname, '_tmp.tar.gz');
    fs.writeFileSync(tmpFile, tarball);
    fs.mkdirSync(BIN_DIR, { recursive: true });

    execSync(`tar xzf "${tmpFile}" -C "${BIN_DIR}"`, { stdio: 'ignore' });

    // Rename platform-specific binary to 'spire'
    const extracted = path.join(BIN_DIR, name);
    if (fs.existsSync(extracted) && extracted !== BIN_PATH) {
      fs.renameSync(extracted, BIN_PATH);
    }

    fs.chmodSync(BIN_PATH, 0o755);
    fs.unlinkSync(tmpFile);

    console.log(`spire v${version} installed successfully!`);
  } catch (err) {
    console.error(`Failed to install spire: ${err.message}`);
    console.error(`You can manually download from: https://github.com/${REPO}/releases`);
    process.exit(1);
  }
}

main();
