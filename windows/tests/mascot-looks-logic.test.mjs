import { test } from "node:test";
import assert from "node:assert/strict";
import { subagentLookFor } from "../src/settings/mascot-looks.ts";

test("a second color change updates the current settings object", () => {
  let settings = {
    subagentLooks: {
      Explore: { color: null, accessory: null, eyes: null, cheeks: null },
    },
  };
  let selected = "#123456";
  const change = () => {
    subagentLookFor(settings, "Explore").color = selected;
  };

  change();
  const oldSettings = settings;
  settings = {
    subagentLooks: {
      Explore: { ...settings.subagentLooks.Explore },
    },
  };
  selected = "#654321";
  change();

  assert.equal(settings.subagentLooks.Explore.color, "#654321");
  assert.equal(oldSettings.subagentLooks.Explore.color, "#123456");
});
