// Which state of a MascotForge export plays for each Coucou state (src/mascot/states.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { MASCOT_STATE_FALLBACKS, playsImmediately, resolveMascotState } from "../src/mascot/states.ts";

const BLOB = ["idle", "listening", "thinking", "talking", "working", "happy", "done", "error"];
const VIDEO = ["idle", "thinking", "talking", "error"];
const COUCOU_STATES = [
  "idle", "working", "thinking", "searching", "approval", "question",
  "error", "finished", "ratelimit", "sleeping", "dizzy",
];

test("every Coucou state has a fallback list", () => {
  for (const s of COUCOU_STATES) assert.ok(MASCOT_STATE_FALLBACKS[s].length > 0, s);
});

test("approval asks the blob to listen", () => {
  assert.equal(resolveMascotState("approval", BLOB, "idle"), "listening");
});

test("approval on a video mascot talks", () => {
  assert.equal(resolveMascotState("approval", VIDEO, "idle"), "talking");
});

test("finished on a blob is done", () => {
  assert.equal(resolveMascotState("finished", BLOB, "idle"), "done");
});

test("searching on a video thinks", () => {
  assert.equal(resolveMascotState("searching", VIDEO, "idle"), "thinking");
});

test("sleeping without a sleeping state falls back to idle", () => {
  assert.equal(resolveMascotState("sleeping", VIDEO, "idle"), "idle");
});

test("nothing matches: the default state", () => {
  assert.equal(resolveMascotState("dizzy", ["wave"], "wave"), "wave");
});

test("only approval and question are immediate", () => {
  assert.equal(playsImmediately("approval"), true);
  assert.equal(playsImmediately("question"), true);
  assert.equal(playsImmediately("working"), false);
});
