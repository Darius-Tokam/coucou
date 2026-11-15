import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { installFakeDom } from "./fakedom.mjs";

const source = await readFile(new URL("../src/mascot/host.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { MascotHost } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("disposing a mascot host removes its listener and iframe", () => {
  const dom = installFakeDom();
  const root = dom.root();
  root.appendChild = (node) => root.append(node);
  const listeners = new Set();
  const previousWindow = globalThis.window;
  globalThis.window = {
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
  };

  try {
    const host = new MascotHost(root);
    host.load({ name: "Test", baseUrl: "mascot://localhost/claude/" });
    assert.equal(listeners.size, 1);
    assert.equal(root.children.length, 1);

    host.dispose();

    assert.equal(listeners.size, 0);
    assert.equal(root.children.length, 0);
    assert.equal(host.active, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
