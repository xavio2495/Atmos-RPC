#!/bin/sh
# Atmos host installer: a local Sepolia RPC endpoint whose calls leave through the Nym mixnet,
# with reads checked against a light client. It also sets up the Atmos Node harness it runs on.
#
#   curl -fsSL https://atmos.xavio.dev/install.sh | sh
#
# Everything goes into one directory (default ~/.atmos). Nothing outside it is touched unless you
# agree to the optional systemd user service.
#
# Settings (environment):
#   ATMOS_REPO     git URL of the Atmos repository (default: the public repository)
#   ATMOS_REF      branch or tag (default: main)
#   ATMOS_DIR      install directory (default: ~/.atmos)
#   ATMOS_PORT     local port (default: 8545)
#   ATMOS_SERVICE  1 = install a systemd user service, 0 = don't; unset = ask if a terminal is present
#   ATMOS_CHECKPOINT  optional trusted Sepolia beacon block root; by default the host picks the
#                  finalized root two beacon APIs agree on, fetched through the mixnet
set -eu

REPO="${ATMOS_REPO:-https://github.com/xavio2495/Atmos-RPC.git}"
REF="${ATMOS_REF:-main}"
DIR="${ATMOS_DIR:-$HOME/.atmos}"
PORT="${ATMOS_PORT:-8545}"
CHAIN_ID=11155111

say() { printf '%s\n' "$*"; }
die() { printf 'atmos: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found"; }

need git
need node
need npm
major=$(node -p 'process.versions.node.split(".")[0]')
# The launcher runs this exact Node: a systemd service doesn't get the login shell's PATH
# (nvm, fnm, asdf and similar install Node outside the system path).
NODE_BIN=$(command -v node)
[ "$major" -ge 24 ] || die "Node 24 or newer is required (found $(node -v))"

# Fetch only what the host needs: the client, the SDK, the harness and the host.
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" fetch --depth 1 origin "$REF"
  git -C "$DIR" checkout -q FETCH_HEAD
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  die "$DIR exists and is not an Atmos install; set ATMOS_DIR to another directory"
else
  say "Installing into $DIR"
  git clone -q --depth 1 --branch "$REF" --filter=blob:none --sparse "$REPO" "$DIR" ||
    die "could not clone $REPO; check your network, or set ATMOS_REPO to a copy you can reach"
fi
git -C "$DIR" sparse-checkout set client sdk harness host

say "Building the harness and the host (this downloads npm packages)"
# npm ci installs exactly the versions in the committed lockfiles.
(cd "$DIR/harness" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent)
(cd "$DIR/host" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund --omit=optional --loglevel=error && npm run build --silent)

# The launcher. The host finds its own trust anchor through the mixnet unless ATMOS_CHECKPOINT is set.
cat > "$DIR/atmos-host" <<EOF
#!/bin/sh
set -eu
cd "$DIR/host"
export PORT="\${PORT:-$PORT}"
exec "$NODE_BIN" --dns-result-order=ipv4first server.mjs
EOF
chmod +x "$DIR/atmos-host"

# Optional: run at login as a systemd user service (writes one file in ~/.config/systemd/user).
service="${ATMOS_SERVICE:-}"
if [ -z "$service" ] && (: > /dev/tty) 2>/dev/null && command -v systemctl >/dev/null 2>&1; then
  printf 'Install a systemd user service so the host runs in the background? [y/N] ' > /dev/tty
  read -r answer < /dev/tty || answer=""
  case "$answer" in [yY]*) service=1 ;; *) service=0 ;; esac
fi
if [ "$service" = 1 ]; then
  need systemctl
  unit="$HOME/.config/systemd/user/atmos-host.service"
  mkdir -p "$(dirname "$unit")"
  cat > "$unit" <<EOF
[Unit]
Description=Atmos host: Sepolia RPC over the Nym mixnet
After=network-online.target

[Service]
ExecStart=$DIR/atmos-host
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now atmos-host.service
  say "Started atmos-host.service (logs: journalctl --user -u atmos-host -f)"
else
  say "Start the host with: $DIR/atmos-host"
fi

say ""
say "Add this network to MetaMask (Settings > Networks > Add a network manually):"
say "  Network name:  Sepolia via Atmos"
say "  RPC URL:       http://127.0.0.1:$PORT/$CHAIN_ID"
say "  Chain ID:      $CHAIN_ID"
say "  Currency:      SepoliaETH"
say "The first answer takes 15-70 s while the host joins the mixnet; check http://127.0.0.1:$PORT/ for its status."
