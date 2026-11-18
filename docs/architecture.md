# 架构与模块接口

《守护夜排档：套圈篇》（Toss-ing Dead）：Three.js r180 + Vite 的纯前端浏览器游戏。
雨夜唐人街的套圈摊，地上摆着奖品；套中奖品得分，**每没套中一次，街上的僵尸就往前扑一步**，走到摊前就把摊主抓住。
三次被抓，这一局收档。一晚五轮（「上菜」），第五轮是尸潮。

## 坐标

单位米、秒。玩家站在原点，看向 -Z，+Y 朝上。摊台前沿在 z≈-0.5，奖品场从 z=-2.3 往远处排，僵尸从 z=-20 走来，到 z=-1.0（`TUNE.zombies.grabZ`）抓人。

## 模块

数字全在 `src/tune.js` 的 `TUNE`。**纯逻辑模块（physics、aim、rules）不能导入 THREE 或碰 DOM**，node 测试直接导入它们。

| 文件                                     | 负责                                               | 导出                                                     |
| ---------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `src/tune.js`                            | 全部数值                                           | `TUNE`                                                   |
| `src/ring/physics.js`                    | 圈的飞行、落地、套中/擦边判定（纯）                | `launchVelocity`、`createRing`、`stepRing`、`previewArc` |
| `src/ring/aim.js`                        | 鼠标 / 触屏输入 → 瞄准和蓄力（DOM）                | `createAim`                                              |
| `src/rules.js`                           | 一局的规则：轮次、机会、连中、僵尸的逻辑位置（纯） | `createRun`                                              |
| `src/world/stage.js`                     | 雨夜街景、摊子、灯、雨（THREE）                    | `createStage`                                            |
| `src/world/prizes.js`                    | 奖品场的模型和布局（THREE）                        | `createPrizes`、`layoutField`（纯，可测）                |
| `src/world/zombies.js`                   | 僵尸模型、动作，按规则里的逻辑位置摆放（THREE）    | `createZombies`                                          |
| `src/audio.js`                           | 音乐、僵尸嗓音、合成音效（WebAudio）               | `createAudio`                                            |
| `src/ui/hud.js` + `src/style.css`        | 标题、HUD、蓄力条、风向、提示、结算（DOM）         | `createHud`                                              |
| `src/i18n/zh-CN.js`、`src/i18n/index.js` | 界面文案                                           | `t(key, vars)`                                           |
| `src/main.js`                            | 启动、渲染循环、把以上接起来                       | —                                                        |

### `src/ring/physics.js`

```js
launchVelocity(yaw, charge, tune, (rand = Math.random)); // → {x,y,z}；yaw 弧度（正 = 向右，+X），charge 0..1
createRing(origin /*[x,y,z]*/, velocity /*{x,y,z}*/); // → ring 状态对象
stepRing(ring, dt, prizes, windX, tune); // → 事件数组（常为空）
previewArc(origin, velocity, windX, tune, fraction, (samples = 24)); // → [{x,y,z}...]，不算碰撞
```

ring 状态：`{ pos:{x,y,z}, vel:{x,y,z}, spin, tilt:{x,z}, bounces, state }`，`state` 为 `"flying" | "ringed" | "grounded" | "done"`。
`prizes` 是 `[{ id, x, z, r, h, alive }]`。每次 y 由上往下穿过某个活着的奖品的顶面 h 时，算水平距离 d：

- `d <= inner - r` → 事件 `{ type:"ringed", prize }`，圈的 state 变 `"ringed"`，之后 pos 吸附到奖品中心、缓缓落到地面；
- `d < outer + r` → 擦边：事件 `{ type:"rim", prize }`，水平速度从奖品中心反射并乘 `rimBounce`，y 速度变 `+rimLift`，`bounces++`；
  擦边满 `maxBounces` 次后不再判擦边，只会落地；
- y 降到 0（地面，圈的厚度忽略）且还在飞 → 事件 `{ type:"miss", x, z }`，state 变 `"grounded"`。

风：水平 x 方向加速度 `windX`。阻力：`vel -= vel * drag * dt`。`spin` 每秒绕 Y 转，`tilt` 给画面用（飞行中轻微摇摆）。

### `src/ring/aim.js`

```js
const aim = createAim(element, tune); // element 接收指针事件（canvas）
aim.update(dt); // 推进蓄力条
aim.state; // { yaw, charge, holding, touch }
aim.onThrow = (yaw, charge) => {};
aim.enabled = true / false; // 菜单打开时关
```

桌面：鼠标横向位置（相对屏幕中心，±半屏 = ±yawMaxDeg）定 yaw；按下开始蓄力，蓄力条在 `chargePeriod` 里 0→1→0 往返；松开出手。空格键同样可以蓄力和出手。
触屏：和桌面一样按住蓄力、松开出手；按住时横向拖动从当前方向转动瞄准（拇指放哪都行，拖 0.8 个屏宽扫过整个范围）。
瞄准预览画出完整弧线，并在落点放一个圈形标记；实际落点只差 `wobble` 的随机量。

### `src/rules.js`

```js
const run = createRun(tune, (rand = Math.random));
run.state; // { phase, round, chances, score, streak, best?, ringedThisRound, windX, zombies:[...], frozen }
run.start(); // 新一局，返回事件
run.throwResult(result); // result: { type:"ringed", prize } | { type:"miss" }（擦边后最终落地也算 miss），返回事件
run.update(dt); // 推进僵尸和计时，返回事件
run.canThrow(); // 是否允许出手（phase === "playing"）
```

`phase`：`"title" | "playing" | "breather" | "grabbed" | "over" | "won"`。
僵尸：`{ id, x, z, state, lunge }`，`state` 为 `"walk" | "lunge" | "frozen" | "flinch" | "grab"`。
事件是 `{ type, ... }` 的数组，种类：`roundStart{round, windX}`、`spawn{zombie}`、`ringed{prize, score, streak}`、`miss`、
`lunge`、`effect{name}`（`pushBack` / `freeze`）、`grab{zombie, chances}`、`roundClear{round}`、`over{score}`、`won{score}`。

规则：

- 每轮 `rounds[i]`：同时在场最多 `alive` 只，每 `spawnEvery` 秒补一只，以 `creep` m/s 往 +Z 走；套中 `target` 个奖品过关。
- 套中：得分 = 奖品 score × (1 + step × streak)（封顶 max），streak+1；离摊最近的僵尸 `flinch` 秒不动；奖品带 effect 时触发。
- 没套中：streak 清零，所有僵尸在 `lungeTime` 里往前扑 `lunge` 米。
- 僵尸 z ≥ `grabZ` → 抓人：chances-1，发 `grab`；phase 变 `"grabbed"` 持续 `grabGrace` 秒，场上僵尸全部清掉，然后回到 `"playing"`。chances 为 0 → `"over"`。
- 过关后 `"breather"` `breather` 秒，清场，进下一轮（风向重抽：`wind.byRound[i]` × 随机正负）。第五轮过关 → `"won"`。

### `src/world/prizes.js`

```js
layoutField(tune, rand); // 纯函数 → [{ id, type, x, z, r, h, score, effect, alive:true }]，按 weight 抽类型
const prizes = createPrizes(THREE, scene, tune);
prizes.setField(list); // 按列表生成网格
prizes.ringed(id); // 套中的动画（跳一下、发光），之后消失
prizes.update(dt, time);
```

### `src/world/stage.js`

```js
const stage = createStage(THREE, scene, renderer); // 返回 { camera, update(dt, time), setWind(windX), quality }
```

### `src/world/zombies.js`

```js
const zombies = await createZombies(THREE, scene, baseUrl); // 加载 GLB
zombies.sync(run.state.zombies, dt); // 按逻辑位置摆放、选动作；从列表里消失的就淡出
zombies.clear();
```

### `src/audio.js`

```js
const audio = createAudio(baseUrl);
audio.unlock(); // 第一次点击时
audio.play(name); // "throw" | "ringed" | "rim" | "miss" | "lunge" | "grab" | "roundClear" | "over" | "won" | "effect"
audio.music(on);
audio.setRound(round, horde);
```

### `src/ui/hud.js`

```js
const hud = createHud(rootElement, t);
hud.showTitle(onStart) /
  hud.showOver(score, onRetry) /
  hud.showWon(score, onRetry);
hud.update(runState, aimState); // 每帧：机会、轮次、分数、连中、蓄力条、风向
hud.toast(key, vars); // 短提示
hud.hideMenus();
```
