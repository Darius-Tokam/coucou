// Messages between the island (src/mascot/host.ts) and the mascot iframe,
// whose page the `mascot` protocol serves (src-tauri/src/mascot.rs FRAME_HTML).

/**
 * Island → iframe. The iframe's page is served by the `mascot` protocol
 * (mascot.rs FRAME_HTML): it loads the export by itself, on its own origin.
 */
export type HostMessage =
  | { type: "state"; state: string; immediate: boolean }
  /** The cursor, in the iframe's coordinates: the engine looks at it. */
  | { type: "pointer"; x: number; y: number }
  /** A click on the mascot: the engine's own reaction (3D: a hop). */
  | { type: "poke" };

/** Iframe → island. */
export type FrameMessage = { type: "ready" } | { type: "error"; message: string };
