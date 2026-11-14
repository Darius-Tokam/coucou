// The page inside the mascot iframe: loads a MascotForge export's mascot.js
// from the asset protocol, shows its <mascot-avatar>, and plays the states the
// island asks for. One document per mascot: switching mascots reloads the
// iframe, so each export registers its own <mascot-avatar>.

import type { FrameMessage, HostMessage } from "./protocol";

interface MascotAvatar extends HTMLElement {
  ready(): Promise<void>;
  play(state: string, options?: { immediate?: boolean }): Promise<void>;
}

let avatar: MascotAvatar | null = null;

function tell(message: FrameMessage): void {
  window.parent.postMessage(message, window.location.origin);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`mascot.js failed to load: ${src}`));
    document.head.appendChild(script);
  });
}

async function load(manifestUrl: string, scriptUrl: string): Promise<void> {
  try {
    await loadScript(scriptUrl);
    await customElements.whenDefined("mascot-avatar");
    const el = document.createElement("mascot-avatar") as MascotAvatar;
    el.setAttribute("manifest", manifestUrl);
    el.setAttribute("follow-cursor", "false");
    document.body.appendChild(el);
    await el.ready();
    avatar = el;
    tell({ type: "ready" });
  } catch (err) {
    tell({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  const message = event.data;
  if (message.type === "load") void load(message.manifestUrl, message.scriptUrl);
  else if (message.type === "state" && avatar) void avatar.play(message.state, { immediate: message.immediate });
});
