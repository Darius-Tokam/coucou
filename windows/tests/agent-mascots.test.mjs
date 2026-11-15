import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  AgentMascots,
  agentEventFrom,
  exportFor,
  familyOf,
  visibleSlots,
} from "../src/mascot/agents.ts";

const mascots = new AgentMascots();
const A = { name: "A" };
const B = { name: "B" };

const event = (name, extra = {}) => agentEventFrom({
  hook_event_name: name,
  session_id: "s1",
  ...extra,
}, "integration_claude", "Coucou");

beforeEach(() => mascots.clear());

test("familyOf sorts the tags", () => {
  assert.equal(familyOf(undefined), "claude");
  assert.equal(familyOf("claude-desktop"), "claude");
  assert.equal(familyOf("codex"), "codex");
  assert.equal(familyOf("gemini"), null);
});

test("a session already running appears on its first event", () => {
  mascots.apply(event("PreToolUse", { tool_name: "Read" }), 1000);
  assert.equal(mascots.list.length, 1);
  assert.equal(mascots.list[0].state, "working");
  assert.equal(mascots.list[0].subagent, false);
  assert.equal(mascots.list[0].label, "Coucou");
});

test("subagents get their own mascot and follow their own tools", () => {
  mascots.apply(event("SessionStart"), 1000);
  mascots.apply(event("SubagentStart", { agent_id: "a1", agent_type: "Explore" }), 1001);
  mascots.apply(event("PermissionRequest", { agent_id: "a1", agent_type: "Explore" }), 1002);
  assert.equal(mascots.list.length, 2);
  assert.equal(mascots.list[0].state, "idle");
  assert.equal(mascots.list[1].state, "approval");
  assert.equal(mascots.list[1].label, "Explore");
});

test("helper subagents with an empty type get none", () => {
  mascots.apply(event("SubagentStart", { agent_id: "a1", agent_type: "" }), 1000);
  assert.equal(mascots.list.length, 0);
  mascots.apply(event("PreToolUse", { agent_id: "a1", agent_type: "", tool_name: "Read" }), 1001);
  assert.equal(mascots.list.length, 1);
  assert.equal(mascots.list[0].key, "claude:s1");
  assert.equal(mascots.list[0].state, "working");
});

test("a finished subagent leaves after three seconds", () => {
  mascots.apply(event("SubagentStart", { agent_id: "a1", agent_type: "Explore" }), 1000);
  mascots.apply(event("SubagentStop", { agent_id: "a1", agent_type: "Explore" }), 2000);
  assert.equal(mascots.list[0].state, "finished");
  mascots.tick(4999);
  assert.equal(mascots.list.length, 1);
  mascots.tick(5000);
  assert.equal(mascots.list.length, 0);
});

test("stop shows finished then idle", () => {
  mascots.apply(event("SessionStart"), 1000);
  mascots.apply(event("Stop"), 2000);
  assert.equal(mascots.list[0].state, "finished");
  mascots.tick(5000);
  assert.equal(mascots.list[0].state, "idle");
});

test("a silent session sleeps, then leaves after thirty minutes", () => {
  mascots.apply(event("SessionStart"), 1000);
  mascots.tick(121001);
  assert.equal(mascots.list[0].state, "sleeping");
  mascots.tick(1801001);
  assert.equal(mascots.list.length, 0);
});

test("a question tool asks", () => {
  mascots.apply(event("PreToolUse", { tool_name: "mcp__x:ask_question" }), 1000);
  assert.equal(mascots.list[0].state, "question");
});

test("twenty agents show eight and a plus", () => {
  assert.deepEqual(visibleSlots(20), { shown: 8, more: 12 });
  assert.deepEqual(visibleSlots(3), { shown: 3, more: 0 });
});

test("codex falls back to the claude export", () => {
  assert.equal(exportFor("codex", A, null), A);
  assert.equal(exportFor("codex", A, B), B);
  assert.equal(exportFor("claude", null, B), null);
});

test("nextChangeAt points at the next departure", () => {
  mascots.apply(event("SubagentStart", { agent_id: "a1", agent_type: "Explore" }), 1000);
  mascots.apply(event("SubagentStop", { agent_id: "a1", agent_type: "Explore" }), 2000);
  assert.equal(mascots.nextChangeAt(), 5000);
});

test("active states go idle before sleeping after silence", () => {
  for (const [name, extra] of [
    ["UserPromptSubmit", {}],
    ["PreToolUse", { tool_name: "Read" }],
    ["StopFailure", {}],
  ]) {
    mascots.clear();
    mascots.apply(event(name, extra), 1000);
    mascots.tick(121000);
    assert.equal(mascots.list[0].state, "idle", name);
    mascots.tick(240999);
    assert.equal(mascots.list[0].state, "idle", name);
    mascots.tick(241000);
    assert.equal(mascots.list[0].state, "sleeping", name);
  }
});

test("approval and question stay awake while silent", () => {
  mascots.apply(event("PermissionRequest"), 1000);
  mascots.apply(event("PreToolUse", { agent_id: "a1", agent_type: "Explore", tool_name: "ask_question" }), 1000);
  mascots.tick(241000);
  assert.equal(mascots.list[0].state, "approval");
  assert.equal(mascots.list[1].state, "question");
});

test("interrupt and stop failure match the tab states", () => {
  mascots.apply(event("PreToolUse", { tool_name: "Read" }), 1000);
  mascots.apply(event("Interrupt"), 1001);
  assert.equal(mascots.list[0].state, "idle");
  mascots.apply(event("StopFailure"), 1002);
  assert.equal(mascots.list[0].state, "error");
});

test("notifications match rate limits and questions", () => {
  mascots.apply(event("Notification", { message: "Rate limit reached" }), 1000);
  assert.equal(mascots.list[0].state, "ratelimit");
  mascots.apply(event("Notification", { message: "Continue?" }), 1001);
  assert.equal(mascots.list[0].state, "question");
});

test("an event without a state keeps a finished transition", () => {
  mascots.apply(event("SessionStart"), 1000);
  mascots.apply(event("Stop"), 2000);
  mascots.apply(event("UnknownEvent"), 3000);
  mascots.tick(5000);
  assert.equal(mascots.list[0].state, "idle");
});

test("an event without a state keeps a scheduled departure", () => {
  const agent = { agent_id: "a1", agent_type: "Explore" };
  mascots.apply(event("SubagentStart", agent), 1000);
  mascots.apply(event("SubagentStop", agent), 2000);
  mascots.apply(event("UnknownEvent", agent), 3000);
  mascots.tick(5000);
  assert.equal(mascots.list.length, 0);
});

test("session end also removes its subagents", () => {
  mascots.apply(event("SessionStart"), 1000);
  mascots.apply(event("SubagentStart", { agent_id: "a1", agent_type: "Explore" }), 1001);
  mascots.apply(event("SubagentStart", { agent_id: "a2", agent_type: "Plan" }), 1002);
  mascots.apply(agentEventFrom({
    hook_event_name: "SubagentStart",
    session_id: "s2",
    agent_id: "b1",
    agent_type: "Explore",
  }, "integration_claude", "Other"), 1003);

  mascots.apply(event("SessionEnd"), 2000);
  mascots.tick(5000);

  assert.deepEqual(mascots.list.map((mascot) => mascot.key), ["claude:s2:b1"]);
});
