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
  assert.equal(miniClickTarget(subagent, false), "subagent");
});

test("a waiting approval wins", () => {
  assert.equal(miniClickTarget(subagent, true), "approval");
});

test("clicking a session opens its tab", () => {
  assert.equal(miniClickTarget({ ...subagent, subagent: false }, false), "session");
});
