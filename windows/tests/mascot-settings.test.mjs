// Settings → Mascot: what an import error says (src/settings/mascot-errors.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { importErrorText } from "../src/settings/mascot-errors.ts";

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
