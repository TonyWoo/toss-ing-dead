# AGENTS.md

给 AI 编程助手看的说明。

## 项目是什么

《守护夜排档：套圈篇》（Toss-ing Dead）：《守护夜排档 Wok-ing Dead》的姊妹作。雨夜唐人街的套圈摊，套中奖品得分，
没套中一次，僵尸就往前扑一步；被抓三次收档。Three.js r180 + Vite，纯前端。

- 文档和界面默认中文；提交信息用英文祈使句。
- **项目知识写进仓库**：方向看 [docs/decisions.md](docs/decisions.md)，现状看 [docs/status.md](docs/status.md)，
  模块接口看 [docs/architecture.md](docs/architecture.md)，素材许可看 [docs/assets.md](docs/assets.md)。
- 开子代理时用 haiku 模型（Dash 2026-11-18 的要求）。

## 命令

```sh
npm ci
npm run dev      # http://127.0.0.1:5273/
npm run check    # JS 语法 + Prettier
npm test         # 物理、规则、奖品布局的 node 测试
npm run build
npm run verify   # check + build + test
```

推 `main` 后 GitHub Actions 自动部署到 GitHub Pages：https://tonywoo.github.io/toss-ing-dead/

## 规则

- 数值只写在 `src/tune.js`。`src/rules.js`、`src/ring/physics.js`、`layoutField` 是纯逻辑，不导入 THREE、不碰 DOM。
- 模块之间按 docs/architecture.md 的接口接；改接口时同时改文档。
- 界面文案只写在 `src/i18n/`。菜单用小摊 / 厨房双关（「开档」「收档了。」），HUD 保持严肃。
- 交付前 `npm run verify` 通过；没在浏览器里试过就如实说，并写出试玩时该看哪里。
