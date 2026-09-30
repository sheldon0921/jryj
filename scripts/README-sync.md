# 油价数据自动同步

数据源：油价通（`m.youjiatong.com`）的 31 个省级挂牌价页面、`/tiaozheng.html` 调价日历、`/guoji.html` 国际原油。
产出：`web/data.js` 与 `miniprogram/utils/oil-data.js`，查看日期与下次窗口仍由页面按当天计算，脚本只负责价格与日程基准。

## 手动跑

```sh
node scripts/sync-oil.mjs            # 试运行：结果写 scripts/.sync/，不改源文件
node scripts/sync-oil.mjs --apply    # 正式写入两处数据文件
sh scripts/sync-and-push.sh          # 抓取 + 有变化时提交并推送到 GitHub
```

校验不通过（地区数不足 31、价格越界、92/95 号倒挂、日历里“本轮”与日程对不上、下一轮窗口与推算不一致）时脚本退出码 1 且不写任何文件。
源站挂牌日期不是当天时属于阻断级告警，确认上游确实没更新可加 `--force`。

## 定时（launchd，需要你自己执行）

```sh
cp scripts/com.qoder.oil-sync.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.qoder.oil-sync.plist
launchctl kickstart -p gui/$(id -u)/com.qoder.oil-sync   # 立即跑一次
```

每天 08:30、18:30 各一次，日志在 `logs/sync-YYYY-MM-DD.log` 与 `logs/launchd.*.log`。
卸载：`launchctl bootout gui/$(id -u)/com.qoder.oil-sync` 后删除 plist。

## 两个前提

- 推送依赖 `gh` 已登录（脚本内用 `credential.helper=!gh auth git-credential`，不落盘凭据）；若长期无人值守，建议先跑一次 `gh auth setup-git`。
- 脚本只更新仓库和站点源文件，**线上站点不会自己变**；需要在 Qoder 里重新走一次发布。小程序同理，要在微信开发者工具重新上传、提审。
