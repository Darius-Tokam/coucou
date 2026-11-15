// The island's side of the mascot iframe: shows the active MascotForge export
// in `container` and passes it the states to play.

import type { MascotInfo } from "../core/bridge";
import type { FrameMessage, HostMessage } from "./protocol";

type MascotLook = Omit<Extract<HostMessage, { type: "look" }>, "type">;

const EMPTY_LOOK: MascotLook = {
  color: null,
  material: null,
  accessory: null,
  eyes: null,
  cheeks: null,
};

function sameLook(a: MascotLook | null, b: MascotLook | null): boolean {
  if (a === null || b === null) return a === b;
  return a.color === b.color
    && a.material === b.material
    && a.accessory === b.accessory
    && a.eyes === b.eyes
    && a.cheeks === b.cheeks;
}

export interface MascotHostOptions {
  mini?: boolean;
}

export class MascotHost {
  onError: ((message: string) => void) | null = null;

  private frame: HTMLIFrameElement | null = null;
  private loads = 0;
  private ready = false;
  /** The last state asked for, replayed once the mascot is ready. */
  private wanted: { state: string; immediate: boolean } | null = null;
  /** The last pause asked for, replayed once the mascot is ready. */
  private paused: boolean | null = null;
  /** The last custom look, replayed once the mascot is ready. */
  private look: MascotLook | null = null;
  private readonly mini: boolean;
  private readonly messageListener = (event: MessageEvent<FrameMessage>) => {
    if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
    if (event.data.type === "ready") {
      this.ready = true;
      if (this.wanted) this.send({ type: "state", ...this.wanted });
      if (this.paused !== null) this.send({ type: "pause", paused: this.paused });
      if (this.look !== null) this.send({ type: "look", ...this.look });
    } else if (event.data.type === "error") {
      this.onError?.(event.data.message);
    }
  };

  constructor(private readonly container: HTMLElement, options: MascotHostOptions = {}) {
    this.mini = options.mini === true;
    window.addEventListener("message", this.messageListener);
  }

  /** True while a MascotForge mascot is shown (Mochi otherwise). */
  get active(): boolean {
    return this.frame !== null;
  }

  /** Where the iframe's page comes from: the `mascot` protocol's origin. */
  private origin = "";

  /** Shows `info`, or removes the mascot when null. Always a fresh document. */
  load(info: MascotInfo | null): void {
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    if (!info) return;
    this.origin = new URL(info.baseUrl).origin;

    const frame = document.createElement("iframe");
    frame.className = "mascot-frame";
    frame.title = info.name;
    frame.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none;";
    // Its own origin: the export's scripts can't reach this window or Tauri.
    const query = this.mini ? `mini=1&v=${++this.loads}` : `v=${++this.loads}`;
    frame.src = `${info.baseUrl}__coucou_frame.html?${query}`;
    this.frame = frame;
    this.container.appendChild(frame);
  }

  /** Plays a state of the mascot (a name the export has). */
  play(state: string, immediate: boolean): void {
    this.wanted = { state, immediate };
    if (this.ready) this.send({ type: "state", state, immediate });
  }

  /** The cursor, in the iframe's coordinates. */
  pointer(x: number, y: number): void {
    if (this.ready) this.send({ type: "pointer", x, y });
  }

  /** A click on the mascot. */
  poke(): void {
    if (this.ready) this.send({ type: "poke" });
  }

  /** Pauses or resumes drawing, without repeating an unchanged request. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (this.ready) this.send({ type: "pause", paused });
  }

  /** Applies a subagent look, without repeating an unchanged request. */
  setLook(look: MascotLook | null): void {
    if (sameLook(look, this.look)) return;
    this.look = look;
    if (this.ready) this.send({ type: "look", ...(look ?? EMPTY_LOOK) });
  }

  dispose(): void {
    window.removeEventListener("message", this.messageListener);
    this.load(null);
    this.onError = null;
  }

  private send(message: HostMessage): void {
    if (this.origin) this.frame?.contentWindow?.postMessage(message, this.origin);
  }
}
