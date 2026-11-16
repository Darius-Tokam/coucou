import type { SubagentLook } from "../core/state";

interface MascotLookSettings {
  subagentLooks?: Record<string, SubagentLook>;
}

export function subagentLookFor(settings: MascotLookSettings, type: string): SubagentLook {
  settings.subagentLooks ??= {};
  return settings.subagentLooks[type] ??= {
    color: null,
    accessory: null,
    eyes: null,
    cheeks: null,
  };
}
