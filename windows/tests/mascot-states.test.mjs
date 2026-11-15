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

const ORBI = ["idle", "listening", "thinking", "speaking", "working", "error", "celebrating", "surprised", "sleeping", "sad"];

test("a hovered idle mascot is surprised", async () => {
  const { mascotStateFor } = await import("../src/mascot/states.ts");
  assert.equal(mascotStateFor("idle", true, ORBI, "idle"), "surprised");
});

test("an export's own hover state wins", async () => {
  const { mascotStateFor } = await import("../src/mascot/states.ts");
  assert.equal(mascotStateFor("idle", true, [...ORBI, "hover"], "idle"), "hover");
});

test("hovering wakes a sleeping mascot", async () => {
  const { mascotStateFor } = await import("../src/mascot/states.ts");
  assert.equal(mascotStateFor("sleeping", true, ORBI, "idle"), "surprised");
});

test("an agent at work keeps its animation under the pointer", async () => {
  const { mascotStateFor } = await import("../src/mascot/states.ts");
  assert.equal(mascotStateFor("working", true, ORBI, "idle"), "working");
  assert.equal(mascotStateFor("approval", true, ORBI, "idle"), "listening");
});

test("no hover, no change", async () => {
  const { mascotStateFor } = await import("../src/mascot/states.ts");
  assert.equal(mascotStateFor("idle", false, ORBI, "idle"), "idle");
});

test("the corner mascot shows the agent that needs you most, whatever pill is open", async () => {
  const { cornerAgentState } = await import("../src/mascot/states.ts");
  assert.equal(cornerAgentState(["idle", "working"], null), "working");
  assert.equal(cornerAgentState(["working", "approval", "idle"], null), "approval");
  assert.equal(cornerAgentState(["finished", "thinking"], null), "thinking");
  assert.equal(cornerAgentState(["sleeping", "idle"], null), "idle");
  assert.equal(cornerAgentState([], null), "idle");
});

test("a state Coucou forces wins over the agents", async () => {
  const { cornerAgentState } = await import("../src/mascot/states.ts");
  assert.equal(cornerAgentState(["working"], "dizzy"), "dizzy");
});
