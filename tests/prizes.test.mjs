// layoutField 是纯函数：不需要 scene，也不需要 THREE。
import { test } from "node:test";
import assert from "node:assert/strict";
import { TUNE } from "../src/tune.js";
import { layoutField } from "../src/world/prizes.js";

// 带种子的随机数（mulberry32），让布局可以复现
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { cols, rows, spacingX, nearZ, spacingZ, jitter } = TUNE.field;
const maxX = ((cols - 1) * spacingX) / 2 + jitter;
const minZ = nearZ - (rows - 1) * spacingZ - jitter;
const maxZ = nearZ + jitter;

test("layout has cols * rows prizes", () => {
  const list = layoutField(TUNE, seeded(1));
  assert.equal(list.length, cols * rows);
});

test("ids are unique within a call and across calls", () => {
  const a = layoutField(TUNE, seeded(1));
  const b = layoutField(TUNE, seeded(2));
  const ids = new Set([...a, ...b].map((p) => p.id));
  assert.equal(ids.size, a.length + b.length);
});

test("every prize stands inside the field", () => {
  for (const p of layoutField(TUNE, seeded(3))) {
    assert.ok(Math.abs(p.x) <= maxX, `x ${p.x} outside ±${maxX}`);
    assert.ok(
      p.z >= minZ && p.z <= maxZ,
      `z ${p.z} outside [${minZ}, ${maxZ}]`,
    );
    assert.equal(p.alive, true);
  }
});

test("every type exists in tune.prizes and carries its numbers", () => {
  for (const p of layoutField(TUNE, seeded(4))) {
    const def = TUNE.prizes[p.type];
    assert.ok(def, `unknown type ${p.type}`);
    assert.equal(p.r, def.r);
    assert.equal(p.h, def.h);
    assert.equal(p.score, def.score);
    assert.equal(p.effect, def.effect ?? null);
  }
});

test("same seed gives the same layout (ids aside)", () => {
  const a = layoutField(TUNE, seeded(7));
  const b = layoutField(TUNE, seeded(7));
  const strip = (list) => list.map(({ type, x, z }) => ({ type, x, z }));
  assert.deepEqual(strip(a), strip(b));
});
