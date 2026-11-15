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

function hostDom() {
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
  return {
    listeners,
    root,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

test("disposing a mascot host removes its listener and iframe", () => {
  const dom = hostDom();

  try {
    const host = new MascotHost(dom.root);
    host.load({ name: "Test", baseUrl: "mascot://localhost/claude/" });
    assert.equal(dom.listeners.size, 1);
    assert.equal(dom.root.children.length, 1);

    host.dispose();

    assert.equal(dom.listeners.size, 0);
    assert.equal(dom.root.children.length, 0);
    assert.equal(host.active, false);
  } finally {
    dom.restore();
  }
});

test("pause is sent once per change and replayed when the mascot is ready", () => {
  const dom = hostDom();
  try {
    const messages = [];
    const host = new MascotHost(dom.root);
    host.load({ name: "Test", baseUrl: "mascot://localhost/claude/" });
    const frame = dom.root.children[0];
    frame.contentWindow = { postMessage: (message) => messages.push(message) };

    host.setPaused(true);
    host.setPaused(true);
    assert.deepEqual(messages, []);

    const listener = [...dom.listeners][0];
    listener({
      source: frame.contentWindow,
      origin: new URL("mascot://localhost/claude/").origin,
      data: { type: "ready" },
    });
    assert.deepEqual(messages, [{ type: "pause", paused: true }]);

    host.setPaused(true);
    host.setPaused(false);
    host.setPaused(false);
    assert.deepEqual(messages, [
      { type: "pause", paused: true },
      { type: "pause", paused: false },
    ]);
    host.dispose();
  } finally {
    dom.restore();
  }
});

test("setLook sends once per change", () => {
  const dom = hostDom();
  try {
    const messages = [];
    const host = new MascotHost(dom.root);
    host.load({ name: "Test", baseUrl: "mascot://localhost/claude/" });
    const frame = dom.root.children[0];
    frame.contentWindow = { postMessage: (message) => messages.push(message) };
    const listener = [...dom.listeners][0];
    listener({
      source: frame.contentWindow,
      origin: new URL("mascot://localhost/claude/").origin,
      data: { type: "ready" },
    });
    const blue = {
      color: "#60A5FA",
      material: "shell",
      accessory: null,
      eyes: null,
      cheeks: null,
    };

    host.setLook(blue);
    host.setLook({ ...blue });
    host.setLook({ ...blue, color: "#34D399" });

    assert.deepEqual(messages, [
      { type: "look", ...blue },
      { type: "look", ...blue, color: "#34D399" },
    ]);
    host.dispose();
  } finally {
    dom.restore();
  }
});

test("setLook is replayed when ready", () => {
  const dom = hostDom();
  try {
    const messages = [];
    const host = new MascotHost(dom.root);
    host.load({ name: "Test", baseUrl: "mascot://localhost/claude/" });
    const frame = dom.root.children[0];
    frame.contentWindow = { postMessage: (message) => messages.push(message) };
    const look = {
      color: "#F472B6",
      material: "lilac",
      accessory: "cap",
      eyes: "round",
      cheeks: "rose",
    };

    host.setLook(look);
    assert.deepEqual(messages, []);

    const listener = [...dom.listeners][0];
    listener({
      source: frame.contentWindow,
      origin: new URL("mascot://localhost/claude/").origin,
      data: { type: "ready" },
    });
    assert.deepEqual(messages, [{ type: "look", ...look }]);
    host.dispose();
  } finally {
    dom.restore();
  }
});

test("only a mini mascot frame asks for reduced resolution", () => {
  const dom = hostDom();
  try {
    const large = new MascotHost(dom.root);
    large.load({ name: "Large", baseUrl: "mascot://localhost/claude/" });
    assert.equal(new URL(dom.root.children[0].src).searchParams.has("mini"), false);
    large.dispose();

    const mini = new MascotHost(dom.root, { mini: true });
    mini.load({ name: "Mini", baseUrl: "mascot://localhost/codex/" });
    assert.equal(new URL(dom.root.children[0].src).searchParams.get("mini"), "1");
    mini.dispose();
  } finally {
    dom.restore();
  }
});
