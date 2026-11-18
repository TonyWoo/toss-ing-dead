// HUD、标题和结算的 DOM。根元素（#hud）由 main.js 提供；这里只在它里面建一次 DOM，
// update() 每帧调用，只改变了的值才写回 DOM。
import { TUNE } from "../tune.js";

const LANTERNS = TUNE.chances;
const WIND_MAX = Math.max(0.01, ...TUNE.wind.byRound.map((w) => Math.abs(w)));
const DANGER_FROM = 0.6;
const SPAWN_Z = TUNE.zombies.spawnZ;
const GRAB_Z = TUNE.zombies.grabZ;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 离摊最近的僵尸有多近：0 = 刚出生，1 = 到了抓人线。
function dangerOf(zombies) {
  let best = 0;
  for (const z of zombies || []) {
    if (!z || typeof z.z !== "number") continue;
    const d = (z.z - SPAWN_Z) / (GRAB_Z - SPAWN_Z);
    if (d > best) best = d;
  }
  return clamp(best, 0, 1);
}

export function createHud(root, t) {
  root.classList.add("hud");
  root.replaceChildren();

  const coarse = () =>
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  // ---------- 游戏中的 HUD ----------
  const play = el("div", "hud-play");
  const vignette = el("div", "vignette");

  // 左上：机会（灯笼）
  const tl = el("div", "hud-tl");
  const lanternBox = el("div", "lanterns");
  lanternBox.setAttribute("role", "img");
  lanternBox.setAttribute("aria-label", t("hud.chances"));
  const lanterns = Array.from({ length: LANTERNS }, () => {
    const lantern = el("span", "lantern");
    lanternBox.append(lantern);
    return lantern;
  });
  tl.append(lanternBox);

  // 上中：轮次、进度、状态
  const tc = el("div", "hud-tc");
  const roundEl = el("div", "round");
  const progressEl = el("div", "progress");
  const statusEl = el("div", "status");
  tc.append(roundEl, progressEl, statusEl);

  // 右上：得分、连中
  const tr = el("div", "hud-tr");
  const scoreLabel = el("div", "score-label", t("hud.score"));
  const scoreEl = el("div", "score-value", "0");
  const comboEl = el("div", "combo");
  comboEl.hidden = true;
  tr.append(scoreLabel, scoreEl, comboEl);

  // 下中：蓄力条（触屏不显示）
  const power = el("div", "power");
  power.hidden = true;
  const powerLabel = el("div", "power-label", t("hud.power"));
  const track = el("div", "power-track");
  const fill = el("div", "power-fill");
  track.append(fill);
  power.append(powerLabel, track);

  // 左下：风向和强度
  const wind = el("div", "hud-wind");
  const windLabel = el("div", "wind-label");
  const chevs = el("div", "chevs");
  const chevEls = [0, 1, 2].map(() => {
    const c = el("span", "chev");
    chevs.append(c);
    return c;
  });
  wind.append(windLabel, chevs);

  const toastEl = el("div", "toast");
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");

  play.append(vignette, tl, tc, tr, power, wind, toastEl);

  // ---------- 菜单（标题 / 收档 / 收工）----------
  const menu = el("div", "menu");
  menu.hidden = true;

  const titlePanel = el("section", "panel");
  titlePanel.dataset.panel = "title";
  const logo = el("h1", "logo", t("title.logo"));
  const badge = el("div", "stamp", t("title.badge"));
  const eyebrow = el("div", "eyebrow", t("title.eyebrow"));
  const tagline = el("p", "tagline", t("title.tagline"));
  const startBtn = el("button", "btn", t("title.start"));
  startBtn.type = "button";
  const help = el(
    "p",
    "help",
    t(coarse() ? "title.help.touch" : "title.help.mouse"),
  );
  titlePanel.append(logo, badge, eyebrow, tagline, startBtn, help);

  const resultPanel = (name, stampKey, titleKey, subKey) => {
    const section = el("section", "panel");
    section.dataset.panel = name;
    const ticket = el("div", "ticket");
    const stamp = el("div", "stamp stamp-ink", t(stampKey));
    const heading = el("h2", "ticket-title", t(titleKey));
    const sub = el("p", "ticket-sub", t(subKey));
    const row = el("div", "ticket-score");
    const label = el("span", "ticket-label", t("result.score"));
    const value = el("span", "ticket-value", "0");
    row.append(label, value);
    ticket.append(stamp, heading, sub, row);
    const btn = el("button", "btn", t("result.retry"));
    btn.type = "button";
    section.append(ticket, btn);
    return { section, value, btn };
  };
  const overPanel = resultPanel("over", "over.stamp", "over.title", "over.sub");
  const wonPanel = resultPanel("won", "won.stamp", "won.title", "won.sub");

  menu.append(titlePanel, overPanel.section, wonPanel.section);
  root.append(play, menu);

  // 按钮：点完先让出焦点（否则空格键会再点一次按钮，把蓄力也触发了）
  let onStart = null;
  let onRetry = null;
  const press = (btn, pick) => {
    btn.addEventListener("click", () => {
      btn.blur();
      const fn = pick();
      hideMenus();
      if (fn) fn();
    });
  };
  press(startBtn, () => onStart);
  press(overPanel.btn, () => onRetry);
  press(wonPanel.btn, () => onRetry);

  const mq =
    typeof matchMedia === "function" ? matchMedia("(pointer: coarse)") : null;
  const onPointerChange = () => {
    help.textContent = t(coarse() ? "title.help.touch" : "title.help.mouse");
  };
  if (mq) {
    if (mq.addEventListener) mq.addEventListener("change", onPointerChange);
    else if (mq.addListener) mq.addListener(onPointerChange);
  }

  function openPanel(name) {
    for (const p of [titlePanel, overPanel.section, wonPanel.section]) {
      p.hidden = p.dataset.panel !== name;
    }
    menu.hidden = false;
    root.classList.add("is-menu");
  }

  function hideMenus() {
    menu.hidden = true;
    root.classList.remove("is-menu");
  }

  function showTitle(fn) {
    onStart = fn;
    onPointerChange();
    openPanel("title");
  }

  function showOver(score, fn) {
    onRetry = fn;
    overPanel.value.textContent = String(Math.floor(score ?? 0));
    openPanel("over");
  }

  function showWon(score, fn) {
    onRetry = fn;
    wonPanel.value.textContent = String(Math.floor(score ?? 0));
    openPanel("won");
  }

  // ---------- 每帧更新（只写变了的值）----------
  const shown = {
    chances: -1,
    round: -1,
    horde: null,
    progress: "",
    score: null,
    streak: -1,
    status: "",
    vignette: -1,
    wind: "",
    charging: null,
    power: -1,
  };

  function pop() {
    scoreEl.classList.remove("pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("pop");
  }

  function update(runState, aimState) {
    const s = runState || {};
    const aim = aimState || {};
    const phase = s.phase || "title";

    const chances = clamp(s.chances ?? 0, 0, LANTERNS);
    if (chances !== shown.chances) {
      shown.chances = chances;
      lanterns.forEach((lantern, i) => {
        lantern.classList.toggle("is-lit", i < chances);
        lantern.classList.toggle("is-off", i >= chances);
      });
    }

    const roundIdx = Math.max(0, s.round ?? 0);
    const cfg = TUNE.rounds[Math.min(roundIdx, TUNE.rounds.length - 1)];
    const target = s.target ?? cfg.target;
    const horde = s.horde ?? !!cfg.horde;
    if (roundIdx !== shown.round) {
      shown.round = roundIdx;
      roundEl.textContent = t("hud.round", { n: roundIdx + 1 });
    }
    if (horde !== shown.horde) {
      shown.horde = horde;
      tc.classList.toggle("is-horde", horde);
    }
    const progress = `${s.ringedThisRound ?? 0}/${target}`;
    if (progress !== shown.progress) {
      shown.progress = progress;
      progressEl.textContent = progress;
    }

    const score = Math.floor(s.score ?? 0);
    if (score !== shown.score) {
      if (shown.score !== null) pop();
      shown.score = score;
      scoreEl.textContent = String(score);
    }
    const streak = s.streak ?? 0;
    if (streak !== shown.streak) {
      shown.streak = streak;
      comboEl.hidden = streak < 2;
      if (streak >= 2) comboEl.textContent = t("hud.combo", { n: streak });
    }

    const danger = dangerOf(s.zombies);
    const frozen = typeof s.frozen === "number" ? s.frozen > 0 : !!s.frozen;
    let status = "";
    if (phase === "grabbed") status = "hud.grabbed";
    else if (frozen) status = "hud.frozen";
    else if (danger > DANGER_FROM) status = "hud.danger";
    else if (horde) status = "hud.horde";
    if (status !== shown.status) {
      shown.status = status;
      statusEl.textContent = status ? t(status) : "";
    }

    const vig =
      danger > DANGER_FROM ? (danger - DANGER_FROM) / (1 - DANGER_FROM) : 0;
    const vq = Math.round((vig * 0.9) / 0.02) * 0.02;
    if (vq !== shown.vignette) {
      shown.vignette = vq;
      vignette.style.opacity = String(vq);
    }

    const w = s.windX ?? 0;
    const dir = w < -0.001 ? "left" : w > 0.001 ? "right" : "calm";
    const level =
      dir === "calm"
        ? 0
        : clamp(Math.round(Math.abs(w) / (WIND_MAX / 3)), 1, 3);
    const windKey = `${dir}${level}`;
    if (windKey !== shown.wind) {
      shown.wind = windKey;
      wind.dataset.dir = dir;
      windLabel.textContent = t(
        dir === "left"
          ? "hud.wind.left"
          : dir === "right"
            ? "hud.wind.right"
            : "hud.wind.calm",
      );
      chevEls.forEach((c, i) => c.classList.toggle("is-on", i < level));
    }

    // 蓄力条只在桌面按住时显示；触屏是甩动，没有蓄力过程
    const charging = !!aim.holding;
    if (charging !== shown.charging) {
      shown.charging = charging;
      power.hidden = !charging;
    }
    if (charging) {
      const q = Math.round(clamp(aim.charge ?? 0, 0, 1) * 100);
      if (q !== shown.power) {
        shown.power = q;
        fill.style.height = `${q}%`;
      }
    }
  }

  // 短提示：新的替换旧的，动画从头放一遍
  function toast(key, vars) {
    toastEl.textContent = t(key, vars);
    toastEl.classList.remove("show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
  }

  return { showTitle, showOver, showWon, hideMenus, update, toast };
}
