#!/usr/bin/env bash
#
# Installs Yomu as a systemd **user** service and restarts it.
#
# Run this on the machine that will serve the app, from a checkout of the repo.
# It is not a push-from-elsewhere deploy: the database is a local file and the
# analyzer reads its dictionary off disk, so the app and its data live together
# and "deploy" means build here and restart here.
#
# A user unit rather than a system one, because everything it touches belongs to
# one person: the checkout, `yomu.db`, and `.env.local` with the model host in
# it. A system unit would need a service account that owns all three, and would
# buy nothing -- nothing here needs a privileged port or another user's files.
#
# Safe to re-run. Every step is idempotent, and the unit is rewritten each time
# so a changed port or path takes effect on the next deploy rather than sitting
# stale in ~/.config.
#
# Settings come from `.env.local`, the same file as YOMU_OLLAMA_URL, and can be
# overridden on the command line for a one-off. See "settings" below.
#
#   YOMU_PORT      port to listen on            (default 3000)
#   YOMU_HOST      address to bind              (default 0.0.0.0)
#   YOMU_SERVICE   systemd unit name            (default yomu)
#   YOMU_SKIP_BUILD=1  reuse the existing .next (for a config-only change)

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO/.env.local"

NODE="$(command -v node || echo node)"
NEXT_BIN="$REPO/node_modules/next/dist/bin/next"

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m警告:\033[0m %s\n' "$1" >&2; }
die() { printf '\033[31m錯誤:\033[0m %s\n' "$1" >&2; exit 1; }

# --- settings ---------------------------------------------------------------
#
# `.env.local` is the place to set these, next to YOMU_OLLAMA_URL. It is the one
# file that already holds this machine's configuration, it is gitignored, and it
# survives a deploy -- whereas a value passed on the command line does not, and
# the unit is rewritten from scratch on every run, so a port set that way would
# silently revert to 3000 on the next plain `npm run deploy`.
#
# Note that Next itself never reads YOMU_PORT or YOMU_HOST. They become `-p` and
# `-H` on the generated ExecStart line, which is why they are read here.
#
# Precedence: the environment wins, for a deliberate one-off; then .env.local;
# then the default.

# Read one KEY=value out of the env file. Parsed rather than sourced: sourcing
# would execute whatever is in there, and would trip over values that are fine
# for dotenv but not for the shell.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" "$ENV_FILE" |
    tail -n 1 |
    tr -d '\r' |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
        -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" \
        -e 's/[[:space:]]*#.*$//'
}

# The same trap the Next.js notes warn about: PowerShell's `>` and `Set-Content`
# write UTF-16, which Next ignores without a word. It would be ignored here too,
# so say so rather than quietly falling back to every default.
#
# Detected by counting bytes with and without NULs, because a NUL cannot be put
# into a grep pattern from bash -- `$'\x00'` collapses to the empty string, which
# matches every file and warns about all of them.
if [ -f "$ENV_FILE" ]; then
  bytes="$(wc -c < "$ENV_FILE")"
  without_nul="$(LC_ALL=C tr -d '\0' < "$ENV_FILE" | wc -c)"
  if [ "$bytes" -ne "$without_nul" ]; then
    warn "$ENV_FILE 看起來不是 UTF-8（含有 NUL 位元組）。Next 與這個指令稿都會忽略它。"
  fi
fi

PORT="${YOMU_PORT:-$(env_value YOMU_PORT)}"
HOST="${YOMU_HOST:-$(env_value YOMU_HOST)}"
SERVICE="${YOMU_SERVICE:-$(env_value YOMU_SERVICE)}"

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
SERVICE="${SERVICE:-yomu}"

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/$SERVICE.service"

# These three are interpolated into a generated unit file, so they are checked
# here rather than left to systemd. Nothing reaches a shell -- ExecStart is an
# argument vector, not a command line -- but an unchecked value still writes a
# unit that fails at start time with an error pointing at systemd rather than at
# the typo that caused it.
case "$PORT" in
  ''|*[!0-9]*) die "YOMU_PORT 必須是數字（收到「$PORT」）。" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "YOMU_PORT 必須介於 1 到 65535（收到「$PORT」）。"

case "$HOST" in
  *[!A-Za-z0-9.:_-]*) die "YOMU_HOST 只能是位址或主機名稱（收到「$HOST」）。" ;;
esac

case "$SERVICE" in
  ''|*[!A-Za-z0-9_-]*) die "YOMU_SERVICE 只能包含英數字、底線與連字號（收到「$SERVICE」）。" ;;
esac

# The unit is generated, so this is how you read what a deploy would install --
# with this machine's paths and ports filled in, before anything is written.
render_unit() {
  cat <<UNIT_EOF
[Unit]
Description=Yomu — 日文文章閱讀器
Documentation=https://github.com/d4n1elchen/yomu
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
Environment=NODE_ENV=production
# Quoted because systemd splits a command line on whitespace, and a Node
# installed under a path with a space in it would otherwise be read as two
# arguments and fail to start. WorkingDirectory above is deliberately *not*
# quoted: systemd unquotes command arguments but takes a path setting whole, so
# quotes there would become part of the path.
ExecStart="$NODE" "$NEXT_BIN" start -H $HOST -p $PORT

# The analyzer holds kuromoji's dictionary in memory and a chapter's tokens on
# top of it -- a few hundred MB resident is normal, so there is no MemoryMax
# here. An OOM kill mid-import would leave a half-analysed section behind.
Restart=on-failure
RestartSec=5

# The model host serializes requests and a 27B answer takes tens of seconds, so
# a stop has to allow the in-flight one to end rather than killing the process
# out from under a reader.
TimeoutStopSec=30
KillSignal=SIGTERM

StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE

[Install]
WantedBy=default.target
UNIT_EOF
}

if [ "${1:-}" = "--print-unit" ]; then
  render_unit
  exit 0
fi

# --- preflight -------------------------------------------------------------
# Checked up front rather than discovered halfway through: a deploy that fails
# after `npm ci` has already replaced node_modules on a machine that was serving.

[ "$(uname -s)" = "Linux" ] || die "systemd 服務只能部署在 Linux 上（這裡是 $(uname -s)）。"

command -v systemctl >/dev/null || die "找不到 systemctl。"
command -v node >/dev/null || die "找不到 node。"
command -v npm >/dev/null || die "找不到 npm。"

# The user instance is what `systemctl --user` talks to. Over a bare SSH session
# it is often not running, and every later command would fail with a confusing
# "Failed to connect to bus" -- so it is worth naming the fix here.
systemctl --user show-environment >/dev/null 2>&1 ||
  die "systemd 的 user instance 沒有在執行。請以有登入工作階段的方式連線，或先執行：loginctl enable-linger $USER"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
# The project runs TypeScript in strip-only mode, which needs a Node that can
# execute .ts directly -- `db:migrate` below is a .ts file.
[ "$NODE_MAJOR" -ge 22 ] || die "需要 Node 22 以上（目前是 $(node -v)）。"

cd "$REPO"

# Next reads .env.local at runtime, including under NODE_ENV=production. Without
# YOMU_OLLAMA_URL the app falls back to 127.0.0.1:11434, which is right only if
# Ollama runs on this same machine.
[ -f "$REPO/.env.local" ] ||
  warn "找不到 .env.local。模型主機會預設為 http://127.0.0.1:11434。"

# --- build -----------------------------------------------------------------

say "安裝相依套件"
if [ -f "$REPO/package-lock.json" ]; then
  # `npm ci` rather than `install`: it rebuilds the better-sqlite3 native binding
  # against this machine's Node, which a node_modules copied from elsewhere would
  # get wrong.
  npm ci
else
  npm install
fi

# Build before migrating, because the build is the step most likely to fail and
# it touches nothing. Migrating first meant a failed build left the schema moved
# forward with the old server still running on it -- which is the one state
# nothing here is designed for.
if [ "${YOMU_SKIP_BUILD:-}" = "1" ]; then
  say "略過 build（YOMU_SKIP_BUILD=1）"
  [ -d "$REPO/.next" ] || die "沒有既有的 .next 可以沿用。"
else
  say "建置"
  npm run build
fi

say "套用資料庫 migration"
npm run db:migrate

# JMdict is gitignored and regenerable, so a fresh machine has none. The reader
# still works without it -- it hides the difficulty slider rather than marking
# every word -- so this is a warning, not a failure.
if [ ! -d "$REPO/data" ] || [ -z "$(ls -A "$REPO/data" 2>/dev/null)" ]; then
  warn "data/ 是空的，辭典資料還沒匯入。讀取功能可用，但不會標記生難詞。"
  warn "補上的方式：npm run data:jmdict 然後 npm run db:jmdict"
fi

# --- unit ------------------------------------------------------------------

say "寫入 $UNIT"
mkdir -p "$UNIT_DIR"

# ExecStart runs Next's own binary rather than `npm start`, so the process
# systemd supervises is the server itself. Through npm it would be a shell and a
# package-manager process with the real server underneath, and a stop would have
# to travel two hops to reach it.
render_unit > "$UNIT"

say "重新載入並啟動"
systemctl --user daemon-reload
systemctl --user enable "$SERVICE" >/dev/null
systemctl --user restart "$SERVICE"

# Without lingering, the user instance stops at logout and takes the service
# with it -- so an SSH deploy would appear to work and then die on disconnect.
# Best effort: on some systems this needs a polkit prompt that is not available
# over SSH, and failing it is not a reason to fail the deploy.
if command -v loginctl >/dev/null; then
  if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
    loginctl enable-linger "$USER" 2>/dev/null ||
      warn "無法開啟 linger。登出後服務會停止；請手動執行：sudo loginctl enable-linger $USER"
  fi
fi

# --- verify ----------------------------------------------------------------
# Reporting "started" is not the same as reporting "serving". The Library is the
# page to ask for: it renders from the database, so a 200 means the native
# binding loaded and the schema is there.

say "等待服務回應"
PROBE_HOST="$HOST"
[ "$PROBE_HOST" = "0.0.0.0" ] && PROBE_HOST="127.0.0.1"

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null -m 2 "http://$PROBE_HOST:$PORT/library" 2>/dev/null; then
    say "已上線：http://$PROBE_HOST:$PORT/library"
    systemctl --user --no-pager --lines=0 status "$SERVICE" || true
    echo
    echo "紀錄：  journalctl --user -u $SERVICE -f"
    echo "重啟：  systemctl --user restart $SERVICE"
    echo "停止：  systemctl --user stop $SERVICE"
    exit 0
  fi
  sleep 1
done

warn "服務沒有在 30 秒內回應。"
systemctl --user --no-pager --lines=30 status "$SERVICE" || true
journalctl --user -u "$SERVICE" --no-pager --lines=40 || true
exit 1
