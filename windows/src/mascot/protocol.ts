// Messages between the island (src/mascot/host.ts) and the mascot iframe
// (mascot-frame.html, src/mascot/frame.ts).

/** Island → iframe. */
export type HostMessage =
  | { type: "load"; manifestUrl: string; scriptUrl: string }
  | { type: "state"; state: string; immediate: boolean };

/** Iframe → island. */
export type FrameMessage = { type: "ready" } | { type: "error"; message: string };
