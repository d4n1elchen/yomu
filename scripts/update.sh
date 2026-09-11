#!/usr/bin/env bash
#
# Brings the serving machine up to date: fetch, fast-forward, redeploy.
#
# Run it on the box that runs the service, in the same checkout `deploy.sh`
# installed. It does the pulling and then hands over -- everything about
# building, migrating and restarting lives in `deploy.sh` and is not repeated
# here, so the two can never drift into disagreeing about how a deploy works.
#
#   --check    fetch and report what would be pulled, change nothing
#   --force    redeploy even when there is nothing new to pull
#
# Environment variables are passed through to `deploy.sh`: YOMU_PORT, YOMU_HOST,
# YOMU_SERVICE, YOMU_SKIP_BUILD.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m警告:\033[0m %s\n' "$1" >&2; }
die() { printf '\033[31m錯誤:\033[0m %s\n' "$1" >&2; exit 1; }

CHECK_ONLY=""
FORCE=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --force) FORCE=1 ;;
    *) die "不認得的參數「$arg」。可用的是 --check 與 --force。" ;;
  esac
done

command -v git >/dev/null || die "找不到 git。"
cd "$REPO"
git rev-parse --git-dir >/dev/null 2>&1 || die "$REPO 不是 git 儲存庫。"

# --- refuse to touch a dirty checkout --------------------------------------
# A serving machine's checkout should be a copy of the remote and nothing else.
# Local edits here are either someone debugging in production or a half-finished
# change nobody meant to leave, and a fast-forward would either fail confusingly
# or carry them into the running service.

DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY" >&2
  die "工作目錄不乾淨，請先處理上面這些檔案。"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] || die "目前是 detached HEAD，請先切回分支。"

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
[ -n "$UPSTREAM" ] || die "分支 $BRANCH 沒有設定上游，不知道要從哪裡更新。"

say "取得 $UPSTREAM"
git fetch --quiet --prune

BEFORE="$(git rev-parse HEAD)"
AFTER="$(git rev-parse '@{u}')"

# Four states, and only one of them is a normal update. Being *ahead* is told
# apart from having *diverged* on purpose: both are refused, but they are
# different mistakes and "已經分岔" sends you looking for a conflict that is not
# there.
if [ "$BEFORE" = "$AFTER" ]; then
  say "已經是最新版本（$(git rev-parse --short HEAD)）。"

elif git merge-base --is-ancestor "$AFTER" "$BEFORE"; then
  # Upstream is an ancestor of HEAD: this checkout has commits nowhere else.
  die "本地比 $UPSTREAM 多了 $(git rev-list --count "$AFTER..$BEFORE") 個 commit。請先把它們推上去，或還原。"

elif ! git merge-base --is-ancestor "$BEFORE" "$AFTER"; then
  # Neither is an ancestor of the other. Merging here would invent a merge
  # commit nobody reviewed and put unreviewed code into the running service.
  die "本地與 $UPSTREAM 已經分岔。請先在別處理清楚，這裡只做 fast-forward。"

else
  say "有 $(git rev-list --count "$BEFORE..$AFTER") 個新 commit"
  git --no-pager log --oneline --no-decorate "$BEFORE..$AFTER"
  echo
fi

if [ -n "$CHECK_ONLY" ]; then
  say "--check：沒有變更任何東西。"
  exit 0
fi

# Nothing new and no --force is a no-op on purpose. A rebuild and restart drops
# whatever the drain was working on, and paying that for no new code buys
# nothing.
if [ "$BEFORE" = "$AFTER" ] && [ -z "$FORCE" ]; then
  exit 0
fi

if [ "$BEFORE" != "$AFTER" ]; then
  say "快進到 $(git rev-parse --short "$AFTER")"
  git merge --ff-only --quiet "$AFTER"
fi

# --- redeploy ---------------------------------------------------------------
# `deploy.sh` builds before it migrates and restarts only after both succeed, so
# a failure here leaves the service running the previous build. The checkout is
# then ahead of what is being served, which is the state worth naming.

say "重新部署"
if bash "$REPO/scripts/deploy.sh"; then
  exit 0
fi

warn "部署失敗。服務仍在執行更新前的版本，但這份 checkout 已經前進了。"
warn "要退回原本的 commit：git -C $REPO reset --hard $BEFORE 然後重新執行 npm run deploy"
exit 1
