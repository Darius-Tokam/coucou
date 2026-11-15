// Corner mode's pure logic (src/island/corner.ts): what takes the mouse, and
// where the island card sits in the panel area Rust gives it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CORNER_HOVER_CLOSE_S, clampMascotSize, cornerRects, placeInPanel } from "../src/island/corner.ts";

// Mascot bottom-right of the screen: the panel area is on its left, bottom-aligned.
const BOTTOM_RIGHT = {
  window: { x: 984, y: 704, w: 920, h: 320 },
  mascot: { x: 720, y: 120, w: 200, h: 200 },
  panel: { x: 0, y: 0, w: 720, h: 320 },
  minis: [],
};
// Mascot top-left: the panel area is on its right, top-aligned.
const TOP_LEFT = {
  window: { x: 16, y: 16, w: 920, h: 320 },
  mascot: { x: 0, y: 0, w: 200, h: 200 },
  panel: { x: 200, y: 0, w: 720, h: 320 },
  minis: [],
};
const CLOSED = { window: { x: 1704, y: 824, w: 200, h: 200 }, mascot: { x: 0, y: 0, w: 200, h: 200 }, panel: null, minis: [] };

test("closed corner hits only the mascot", () => {
  assert.deepEqual(cornerRects(CLOSED, null), [CLOSED.mascot]);
});

test("open corner hits the mascot and the island card", () => {
  const card = { x: 120, y: 130, w: 600, h: 190 };
  assert.deepEqual(cornerRects(BOTTOM_RIGHT, card), [card, BOTTOM_RIGHT.mascot]);
});

test("the panel takes the mouse before placed minis", () => {
  const r1 = { x: 592, y: 120, w: 120, h: 120 };
  const r2 = { x: 464, y: 120, w: 120, h: 120 };
  const card = { x: 120, y: 130, w: 600, h: 190 };
  const layout = { ...BOTTOM_RIGHT, minis: [r1, r2] };
  assert.deepEqual(cornerRects(layout, card), [card, layout.mascot, r1, r2]);
});

test("the corner closes faster than the top island", () => {
  assert.equal(CORNER_HOVER_CLOSE_S, 0.3);
});

test("big mascot size is clamped before it reaches Rust", () => {
  assert.equal(clampMascotSize(50), 120);
  assert.equal(clampMascotSize(180), 180);
  assert.equal(clampMascotSize(300), 240);
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

test("a click on the folded mascot opens the card", async () => {
  const { mascotClickAction } = await import("../src/island/corner.ts");
  assert.equal(mascotClickAction({ open: false, pinned: false, approvalWaits: false }), "open");
});

test("a click on a hover-opened card pins it", async () => {
  const { mascotClickAction } = await import("../src/island/corner.ts");
  assert.equal(mascotClickAction({ open: true, pinned: false, approvalWaits: false }), "pin");
});

test("a click on a pinned card closes it", async () => {
  const { mascotClickAction } = await import("../src/island/corner.ts");
  assert.equal(mascotClickAction({ open: true, pinned: true, approvalWaits: false }), "close");
});

test("a waiting approval is never clicked out of sight", async () => {
  const { mascotClickAction } = await import("../src/island/corner.ts");
  assert.equal(mascotClickAction({ open: true, pinned: true, approvalWaits: true }), "none");
});

test("a mini keeps a waiting approval visible and focused", async () => {
  const { miniClickAction } = await import("../src/island/corner.ts");
  assert.deepEqual(
    miniClickAction({ approvalWaits: true, defaultView: "approval" }),
    { changeFocus: false, view: "approval" },
  );
  assert.deepEqual(
    miniClickAction({ approvalWaits: false, defaultView: "approval" }),
    { changeFocus: true, view: "overview" },
  );
});

test("the second click of a double click leaves the card open", async () => {
  const { mascotClickAction } = await import("../src/island/corner.ts");
  assert.equal(mascotClickAction({ open: true, pinned: true, approvalWaits: false, sinceOpenMs: 200 }), "none");
});

test("a click well after opening closes the card", async () => {
  const { mascotClickAction } = await import("../src/island/corner.ts");
  assert.equal(mascotClickAction({ open: true, pinned: true, approvalWaits: false, sinceOpenMs: 1500 }), "close");
});

test("the cursor is given to the mascot in its own coordinates", async () => {
  const { mascotPointer } = await import("../src/island/corner.ts");
  const layout = { window: { x: 0, y: 0, w: 600, h: 500 }, mascot: { x: 400, y: 300, w: 200, h: 200 }, panel: null, minis: [] };
  assert.deepEqual(mascotPointer(layout, 450, 320), { x: 50, y: 20, inside: true });
  assert.deepEqual(mascotPointer(layout, 100, 320), { x: -300, y: 20, inside: false });
});
