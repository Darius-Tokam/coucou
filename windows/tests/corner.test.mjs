// Corner mode's pure logic (src/island/corner.ts): what takes the mouse, and
// where the island card sits in the panel area Rust gives it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CORNER_HOVER_CLOSE_S, cornerRects, placeInPanel } from "../src/island/corner.ts";

// Mascot bottom-right of the screen: the panel area is on its left, bottom-aligned.
const BOTTOM_RIGHT = {
  window: { x: 984, y: 704, w: 920, h: 320 },
  mascot: { x: 720, y: 120, w: 200, h: 200 },
  panel: { x: 0, y: 0, w: 720, h: 320 },
};
// Mascot top-left: the panel area is on its right, top-aligned.
const TOP_LEFT = {
  window: { x: 16, y: 16, w: 920, h: 320 },
  mascot: { x: 0, y: 0, w: 200, h: 200 },
  panel: { x: 200, y: 0, w: 720, h: 320 },
};
const CLOSED = { window: { x: 1704, y: 824, w: 200, h: 200 }, mascot: { x: 0, y: 0, w: 200, h: 200 }, panel: null };

test("closed corner hits only the mascot", () => {
  assert.deepEqual(cornerRects(CLOSED, null), [CLOSED.mascot]);
});

test("open corner hits the mascot and the island card", () => {
  const card = { x: 120, y: 130, w: 600, h: 190 };
  assert.deepEqual(cornerRects(BOTTOM_RIGHT, card), [BOTTOM_RIGHT.mascot, card]);
});

test("the corner closes faster than the top island", () => {
  assert.equal(CORNER_HOVER_CLOSE_S, 0.3);
});

test("the card hugs the mascot: bottom-right corner", () => {
  assert.deepEqual(placeInPanel(BOTTOM_RIGHT, 600, 190), { x: 120, y: 130, w: 600, h: 190 });
});

test("the card hugs the mascot: top-left corner", () => {
  assert.deepEqual(placeInPanel(TOP_LEFT, 600, 190), { x: 200, y: 0, w: 600, h: 190 });
});

test("no panel area, no card", () => {
  assert.equal(placeInPanel(CLOSED, 600, 190), null);
});

test("a hover starts once while Rust keeps saying the pointer is there", async () => {
  const { HoverStart } = await import("../src/island/corner.ts");
  const hover = new HoverStart();
  assert.equal(hover.enter(0), true);
  assert.equal(hover.enter(250), false);
  assert.equal(hover.enter(500), false);
  // No word for longer than the poll's gap: the pointer left and came back.
  assert.equal(hover.enter(1200), true);
  hover.leave();
  assert.equal(hover.enter(1300), true);
});
