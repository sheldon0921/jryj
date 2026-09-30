#!/bin/sh
# 定时同步油价数据：抓取校验 → 更新两处数据文件 → 有变化则提交并推送到 GitHub。
# 站点重新发布需要 Qoder（prepare/publish 走插件），本脚本只负责把数据推进仓库。
set -eu

cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p logs
LOG="logs/sync-$(date +%Y-%m-%d).log"
SOURCES="web/data.js miniprogram/utils/oil-data.js"

echo "===== $(date '+%Y-%m-%d %H:%M:%S') 开始同步 =====" >> "$LOG"
if ! node scripts/sync-oil.mjs --apply --json >> "$LOG" 2>&1; then
  echo "同步失败，未改动仓库。详见 $LOG" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

if git diff --quiet -- $SOURCES; then
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') 数据无变化，不提交 =====" >> "$LOG"
  echo "本轮无变化，详见 $LOG"
  exit 0
fi

git add -- $SOURCES
git commit -qm "数据同步：$(date +%Y-%m-%d) 抓取油价通挂牌价与调价日历" >> "$LOG" 2>&1
SHA=$(git log -1 --format=%h)
if git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main >> "$LOG" 2>&1; then
  echo "已提交并推送 $SHA，站点仍需重新发布才会更新。"
else
  echo "已提交 $SHA 但推送失败（gh 凭据或网络），详见 $LOG" >&2
  exit 1
fi
