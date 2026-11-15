import { test } from "node:test";
import assert from "node:assert/strict";
import { activeRoles, selectThumbnailIds } from "../src/settings/mascot-gallery-logic.ts";

test("at most twelve thumbnails load at once", () => {
  const visible = Array.from({ length: 15 }, (_, index) => `mascot-${index}`);

  assert.deepEqual(selectThumbnailIds(visible, []), visible.slice(0, 12));
  assert.deepEqual(
    selectThumbnailIds(visible, ["mascot-13", "mascot-4"]),
    ["mascot-13", "mascot-4", ...visible.filter((id) => !["mascot-13", "mascot-4"].includes(id)).slice(0, 10)],
  );
});

test("the active export is marked per role", () => {
  const item = {
    id: "orbi-blue",
    source: "library",
    info: { sourceId: "orbi-blue" },
  };

  assert.deepEqual(activeRoles(item, {
    claude: { sourceId: "orbi-blue" },
    codex: { sourceId: "fox" },
  }), ["claude"]);
});
