import { test } from "node:test";
import assert from "node:assert/strict";
import { miniClickTarget } from "../src/island/corner.ts";
import { subagentCard } from "../src/views/subagent-card.ts";

const subagent = {
  key: "claude:s1:a1",
  family: "claude",
  pillId: "integration_claude",
  label: "Explore",
  subagent: true,
  state: "finished",
  type: "Explore",
  project: "Coucou",
  steps: ["one", "two", "three", "four", "five", "six", "seven"],
  finalText: "The answer is ready.",
  parentKey: "claude:s1",
};

const session = {
  key: "claude:s1",
  family: "claude",
  pillId: "integration_claude",
  label: "questflow",
  subagent: false,
  state: "working",
  type: null,
  project: "questflow",
  steps: ["Reads \u00b7 brief.md", "Runs \u00b7 tests"],
  finalText: "The session answer is ready.",
  parentKey: null,
};

test("the card keeps every step for its scrolling list and the answer", () => {
  assert.deepEqual(subagentCard(subagent, "#123456"), {
    title: "Explore",
    color: "#123456",
    state: "finished",
    project: "Coucou",
    steps: ["one", "two", "three", "four", "five", "six", "seven"],
    finalText: "The answer is ready.",
  });
});

test("clicking a subagent opens its card", () => {
  assert.equal(miniClickTarget(subagent, false), "card");
});

test("a waiting approval wins", () => {
  assert.equal(miniClickTarget(session, true), "approval");
});

test("clicking a session opens its card", () => {
  assert.equal(miniClickTarget(session, false), "card");
});

test("the grouped mini keeps its current action", () => {
  assert.equal(miniClickTarget("more", false), "more");
});

test("a session card shows its agent, project, steps and final answer", () => {
  assert.deepEqual(subagentCard(session, "#60A5FA"), {
    title: "Claude Code",
    color: "#60A5FA",
    state: "working",
    project: "questflow",
    steps: ["Reads \u00b7 brief.md", "Runs \u00b7 tests"],
    finalText: "The session answer is ready.",
  });
});

test("clicking the open session mini closes its small card", () => {
  assert.equal(miniClickTarget(session, false, session.key, true), "close");
  assert.equal(miniClickTarget(session, false, "claude:s2", true), "card");
  assert.equal(miniClickTarget(session, false, session.key, false), "card");
});
