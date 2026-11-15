// Settings → Mascot: what an import error says (src/settings/mascot-errors.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fakedom.mjs";
import { importErrorText } from "../src/settings/mascot-errors.ts";
import { mascotSection } from "../src/settings/mascot.ts";

installFakeDom();

test("the settings offer a codex mascot", () => {
  const section = mascotSection(() => ({ islandAnchor: "corner" }), () => {});
  const choose = section.find("BUTTON").filter((button) => button.textContent === "Choose a MascotForge folder");
  assert.equal(choose.length, 2);
  assert.match(section.textContent, /Codex mascot/);
});

test("the settings offer size, display and subagent colors", () => {
  const settings = {
    islandAnchor: "corner",
    miniSize: 90,
    miniDisplay: "all",
    subagentLooks: {},
    knownSubagentTypes: ["Explore"],
    miniPositions: { "claude:type:Explore": { x: 100, y: 100 } },
  };
  const section = mascotSection(() => settings, () => {});
  // Two sliders since the big mascot got its own: this one is the small mascots'.
  const range = section.find("INPUT").find((input) =>
    input.getAttribute("type") === "range"
      && input.getAttribute("min") === "60"
      && input.getAttribute("max") === "120"
  );
  assert.ok(range);
  assert.equal(range.getAttribute("step"), "10");
  assert.match(section.textContent, /Small mascots/);
  assert.match(section.textContent, /Subagent colors/);
  assert.match(section.textContent, /Explore/);
  assert.match(section.textContent, /Put the mascots back in line/);
});

test("the settings offer a big mascot size", () => {
  const settings = {
    islandAnchor: "corner",
    mascotSize: 180,
    miniSize: 90,
    miniDisplay: "all",
    subagentLooks: {},
    knownSubagentTypes: [],
    miniPositions: {},
  };
  const section = mascotSection(() => settings, () => {});
  const range = section.find("INPUT").find((input) =>
    input.getAttribute("type") === "range"
      && input.getAttribute("min") === "120"
      && input.getAttribute("max") === "240"
  );

  assert.ok(range);
  assert.equal(range.getAttribute("step"), "20");
  assert.match(section.textContent, /Size of the big mascot/);
});

test("a folder that isn't an export says so", () => {
  assert.equal(importErrorText("not_an_export"), "This folder doesn't hold a MascotForge export.");
});

test("a missing file is named", () => {
  assert.equal(importErrorText("missing_file:videos/idle.mp4"), "A file of the export is missing: videos/idle.mp4");
});

test("an old export asks for a new one", () => {
  assert.equal(importErrorText("wrong_version"), "This export is too old. Export it again from MascotForge.");
});

test("a broken manifest says so", () => {
  assert.equal(importErrorText("bad_manifest"), "The export's manifest.json can't be read.");
});

test("anything else is a copy failure", () => {
  assert.equal(importErrorText("io"), "Coucou couldn't copy the folder.");
  assert.equal(importErrorText("something new"), "Coucou couldn't copy the folder.");
});
