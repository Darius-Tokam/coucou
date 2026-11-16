import { test } from "node:test";
import assert from "node:assert/strict";
import {
  galleryItemKey, miniExportsFor, miniMascotKey,
} from "../src/mascot/mini-exports.ts";

function info(name, engine = "blob") {
  return {
    name,
    engine,
    credit: null,
    alpha: "stacked",
    states: ["idle"],
    defaultState: "idle",
    tintMaterial: null,
    manifestPath: "manifest.json",
    scriptPath: "mascot.js",
    baseUrl: `http://mascot.localhost/${name}/`,
    sourceId: name,
  };
}

function gallery(id, engine = "blob", source = "library") {
  return { id, source, info: info(id, engine) };
}

function session(project, key = `claude:${project}`) {
  return {
    key,
    family: "claude",
    pillId: "integration_claude",
    label: project,
    subagent: false,
    state: "working",
    type: null,
    project,
    steps: [],
    finalText: null,
    parentKey: null,
  };
}

function subagent(type) {
  return {
    ...session("coucou", `claude:coucou:${type}`),
    label: type,
    subagent: true,
    type,
    parentKey: "claude:coucou",
  };
}

const roles = {
  claude: info("claude-role", "3d"),
  codex: info("codex-role", "3d"),
};

const random = { mode: "gallery", pins: {} };

test("the same project gets the same stable gallery mascot", () => {
  const items = [gallery("a"), gallery("b", "3d"), gallery("c")];

  assert.equal(miniExportsFor([session("questflow", "claude:s1")], items, random, roles)[0]?.name, "b");
  assert.equal(miniExportsFor([session("questflow", "claude:s2")], items, random, roles)[0]?.name, "b");
});

test("visible minis avoid duplicate gallery mascots when possible", () => {
  const selected = miniExportsFor(
    [session("questflow"), session("coucou"), subagent("Explore")],
    [gallery("a"), gallery("b", "3d"), gallery("c")],
    random,
    roles,
  );

  assert.equal(new Set(selected.map((item) => item?.name)).size, 3);
});

test("video mascots are excluded from minis", () => {
  const selected = miniExportsFor(
    [session("questflow")],
    [gallery("movie", "video"), gallery("blob", "blob")],
    random,
    roles,
  );

  assert.equal(selected[0]?.name, "blob");
});

test("a pin wins over the random gallery choice", () => {
  const items = [gallery("a"), gallery("b", "3d"), gallery("c")];
  const pins = { [miniMascotKey(session("questflow"))]: galleryItemKey(items[2]) };

  assert.equal(miniExportsFor([session("questflow")], items, { mode: "gallery", pins }, roles)[0]?.name, "c");
});

test("a missing pin falls back to the stable gallery choice", () => {
  const pins = { "project:questflow": "library:gone" };

  assert.equal(
    miniExportsFor([session("questflow")], [gallery("a"), gallery("b", "3d")], { mode: "gallery", pins }, roles)[0]?.name,
    "a",
  );
});

test("an empty eligible gallery falls back to the role mascot", () => {
  assert.equal(miniExportsFor([session("questflow")], [], random, roles)[0]?.name, "claude-role");
  assert.equal(
    miniExportsFor([session("questflow")], [gallery("movie", "video")], random, roles)[0]?.name,
    "claude-role",
  );
});

test("role mode keeps the role mascot", () => {
  assert.equal(
    miniExportsFor([session("questflow")], [gallery("a")], { mode: "role", pins: {} }, roles)[0]?.name,
    "claude-role",
  );
});

test("selection keys follow project or subagent type", () => {
  assert.equal(miniMascotKey(session("questflow")), "project:questflow");
  assert.equal(miniMascotKey(subagent("Explore")), "type:Explore");
});
