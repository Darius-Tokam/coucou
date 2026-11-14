// Messages between the island (src/mascot/host.ts) and the mascot iframe,
// whose page the `mascot` protocol serves (src-tauri/src/mascot.rs FRAME_HTML).

/**
 * Island → iframe. The iframe's page is served by the `mascot` protocol
 * (mascot.rs FRAME_HTML): it loads the export by itself, on its own origin.
 */
export type HostMessage = { type: "state"; state: string; immediate: boolean };

/** Iframe → island. */
export type FrameMessage = { type: "ready" } | { type: "error"; message: string };
