// The island's side of the mascot iframe: shows the active MascotForge export
// in `container` and passes it the states to play.

import type { MascotInfo } from "../core/bridge";
import type { FrameMessage, HostMessage } from "./protocol";

export class MascotHost {
  onError: ((message: string) => void) | null = null;

  private frame: HTMLIFrameElement | null = null;
  private loads = 0;
  private ready = false;
  /** The last state asked for, replayed once the mascot is ready. */
  private wanted: { state: string; immediate: boolean } | null = null;

  constructor(private readonly container: HTMLElement) {
    window.addEventListener("message", (event: MessageEvent<FrameMessage>) => {
      if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
      if (event.data.type === "ready") {
        this.ready = true;
        if (this.wanted) this.send({ type: "state", ...this.wanted });
      } else if (event.data.type === "error") {
        this.onError?.(event.data.message);
      }
    });
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
    frame.src = `${info.baseUrl}__coucou_frame.html?v=${++this.loads}`;
    this.frame = frame;
    this.container.appendChild(frame);
  }

  /** Plays a state of the mascot (a name the export has). */
  play(state: string, immediate: boolean): void {
    this.wanted = { state, immediate };
    if (this.ready) this.send({ type: "state", state, immediate });
  }

  private send(message: HostMessage): void {
    if (this.origin) this.frame?.contentWindow?.postMessage(message, this.origin);
  }
}
