import { test } from "node:test";
import assert from "node:assert/strict";
import { miniDragCancellation } from "../src/island/mini-drag.ts";

test("removing a dragged mini cancels the drag", () => {
  assert.deepEqual(miniDragCancellation(true, "remove"), {
    active: false,
    notify: true,
  });
});

test("losing pointer capture cancels a dragged mini", () => {
  assert.deepEqual(miniDragCancellation(true, "lostpointercapture"), {
    active: false,
    notify: true,
  });
});

test("an inactive mini does not cancel twice", () => {
  assert.deepEqual(miniDragCancellation(false, "pointercancel"), {
    active: false,
    notify: false,
  });
});
