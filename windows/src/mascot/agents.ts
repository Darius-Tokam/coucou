import type { MascotInfo, MascotSlot } from "../core/bridge";
import type { BotStateName } from "../core/layout";

export type MascotFamily = MascotSlot;

export const MINI_LIMIT = 8;
export const LEAVE_MS = 3000;
export const FINISHED_MS = 3000;
export const SLEEP_MS = 120_000;
export const STALE_MS = 1_800_000;
const MAX_STEPS = 50;

export const MINI_COLORS: readonly string[] = [
  "#60A5FA",
  "#34D399",
  "#FBBF24",
  "#F472B6",
  "#A78BFA",
  "#22D3EE",
  "#FB7185",
  "#A3E635",
];

export function familyOf(coucouAgent: string | undefined): MascotFamily | null {
  if (coucouAgent == null || coucouAgent === "" || coucouAgent === "claude-desktop") return "claude";
  if (coucouAgent === "codex") return "codex";
  return null;
}

export interface AgentEvent {
  family: MascotFamily;
  pillId: string;
  name: string;
  sessionId: string;
  agentId: string | null;
  agentType: string | null;
  project: string;
  tool: string | null;
  message: string;
  step: string | null;
  finalText: string | null;
}

export function agentEventFrom(
  p: {
    hook_event_name?: string;
    session_id?: string;
    agent_id?: string;
    agent_type?: string;
    coucou_agent?: string;
    tool_name?: string;
    message?: string;
    last_assistant_message?: string;
  },
  pillId: string,
  project: string,
  step: string | null,
): AgentEvent | null {
  const family = familyOf(p.coucou_agent);
  if (!family || !p.session_id) return null;
  return {
    family,
    pillId,
    name: p.hook_event_name ?? "",
    sessionId: p.session_id,
    agentId: p.agent_id ?? null,
    agentType: p.agent_type ?? null,
    project,
    tool: p.tool_name ?? null,
    message: p.message ?? "",
    step,
    finalText: p.last_assistant_message ?? null,
  };
}

export interface AgentMascot {
  key: string;
  family: MascotFamily;
  pillId: string;
  label: string;
  subagent: boolean;
  state: BotStateName;
  type: string | null;
  project: string;
  steps: readonly string[];
  finalText: string | null;
  parentKey: string | null;
}

interface TrackedMascot extends AgentMascot {
  lastEventAt: number;
  transitionAt: number | null;
  removeAt: number | null;
  idleAt: number | null;
  sleepAt: number | null;
}

const DEPARTURES = new Set(["SubagentStop", "SessionEnd"]);

/**
 * Whether `e` ends its mascot. A Codex session's pill goes 5.2 s after Stop
 * (hooks.ts: external agents), and `codex exec` never sends SessionEnd: its
 * mascot goes with its turn too.
 */
function departs(e: AgentEvent, subagent: boolean): boolean {
  return DEPARTURES.has(e.name) || (e.name === "Stop" && e.family === "codex" && !subagent);
}

function stateFor(e: AgentEvent): BotStateName | null {
  switch (e.name) {
    case "SessionStart":
      return "idle";
    case "UserPromptSubmit":
      return "thinking";
    case "PreToolUse":
      return e.tool === "ask_question" || e.tool?.endsWith(":ask_question") ? "question" : "working";
    case "PostToolUse":
    case "PostToolUseFailure":
    case "SubagentStart":
      return "working";
    case "PermissionRequest":
      return "approval";
    case "Interrupt":
      return "idle";
    case "StopFailure":
      return "error";
    case "Notification": {
      const lower = e.message.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("limite d")) return "ratelimit";
      return e.message.endsWith("?") ? "question" : null;
    }
    case "Stop":
    case "SubagentStop":
    case "SessionEnd":
      return "finished";
    default:
      return null;
  }
}

export class AgentMascots {
  private readonly entries: TrackedMascot[] = [];

  apply(e: AgentEvent, now: number): boolean {
    if (e.agentType === "" && (e.name === "SubagentStart" || e.name === "SubagentStop")) return false;

    const subagent = e.agentId != null && e.agentId !== "" && e.agentType !== "";
    const key = subagent
      ? `${e.family}:${e.sessionId}:${e.agentId}`
      : `${e.family}:${e.sessionId}`;
    let mascot = this.entries.find((item) => item.key === key);

    let changed = false;
    if (e.name === "SessionEnd") {
      const prefix = `${e.family}:${e.sessionId}:`;
      for (const child of this.entries) {
        if (!child.key.startsWith(prefix)) continue;
        child.lastEventAt = now;
        child.transitionAt = null;
        child.removeAt = now + LEAVE_MS;
        child.idleAt = null;
        child.sleepAt = null;
        if (child.state !== "finished") {
          child.state = "finished";
          changed = true;
        }
      }
    }
    if (!mascot && departs(e, subagent)) return changed;

    const state = stateFor(e);
    if (!mascot) {
      mascot = {
        key,
        family: e.family,
        pillId: e.pillId,
        label: subagent ? (e.agentType ?? e.project) : e.project,
        subagent,
        state: state ?? "idle",
        type: subagent ? e.agentType : null,
        project: e.project,
        steps: [],
        finalText: null,
        parentKey: subagent ? `${e.family}:${e.sessionId}` : null,
        lastEventAt: now,
        transitionAt: null,
        removeAt: null,
        idleAt: null,
        sleepAt: null,
      };
      this.entries.push(mascot);
      changed = true;
    }

    if (subagent && e.step != null) {
      mascot.steps = [...mascot.steps, e.step].slice(-MAX_STEPS);
      changed = true;
    }
    if (subagent && e.finalText != null && mascot.finalText !== e.finalText) {
      mascot.finalText = e.finalText;
      changed = true;
    }

    mascot.lastEventAt = now;
    if (state) {
      mascot.transitionAt = null;
      mascot.removeAt = null;
      if (mascot.state !== state) {
        mascot.state = state;
        changed = true;
      }
      this.scheduleSilence(mascot, now);
    } else if (mascot.transitionAt == null && mascot.removeAt == null) {
      this.scheduleSilence(mascot, now);
    }
    if (e.name === "Stop") {
      mascot.transitionAt = now + FINISHED_MS;
      mascot.idleAt = null;
      mascot.sleepAt = mascot.transitionAt + SLEEP_MS;
    }
    if (departs(e, subagent)) {
      mascot.removeAt = now + LEAVE_MS;
      mascot.idleAt = null;
      mascot.sleepAt = null;
    }
    return changed;
  }

  tick(now: number): boolean {
    let changed = false;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const mascot = this.entries[i];
      if ((mascot.removeAt != null && now >= mascot.removeAt) || now >= mascot.lastEventAt + STALE_MS) {
        this.entries.splice(i, 1);
        changed = true;
        continue;
      }
      if (mascot.transitionAt != null && now >= mascot.transitionAt) {
        mascot.transitionAt = null;
        if (mascot.state !== "idle") {
          mascot.state = "idle";
          changed = true;
        }
      }
      if (mascot.idleAt != null && now >= mascot.idleAt) {
        mascot.idleAt = null;
        if (mascot.state !== "idle") {
          mascot.state = "idle";
          changed = true;
        }
      }
      if (mascot.sleepAt != null && mascot.state === "idle" && now >= mascot.sleepAt) {
        mascot.sleepAt = null;
        mascot.state = "sleeping";
        changed = true;
      }
    }
    return changed;
  }

  get list(): readonly AgentMascot[] {
    return this.entries;
  }

  nextChangeAt(): number | null {
    let next: number | null = null;
    const take = (time: number) => {
      if (next == null || time < next) next = time;
    };
    for (const mascot of this.entries) {
      take(mascot.lastEventAt + STALE_MS);
      if (mascot.idleAt != null) take(mascot.idleAt);
      if (mascot.sleepAt != null) take(mascot.sleepAt);
      if (mascot.transitionAt != null) take(mascot.transitionAt);
      if (mascot.removeAt != null) take(mascot.removeAt);
    }
    return next;
  }

  clear(): void {
    this.entries.length = 0;
  }

  private scheduleSilence(mascot: TrackedMascot, now: number): void {
    mascot.idleAt = null;
    mascot.sleepAt = null;
    if (mascot.state === "approval" || mascot.state === "question" || mascot.state === "sleeping") return;
    if (mascot.state === "idle") mascot.sleepAt = now + SLEEP_MS;
    else {
      mascot.idleAt = now + SLEEP_MS;
      mascot.sleepAt = now + SLEEP_MS * 2;
    }
  }
}

export function visibleSlots(count: number): { shown: number; more: number } {
  const shown = Math.min(count, MINI_LIMIT);
  return { shown, more: count - shown };
}

export function exportFor(
  family: MascotFamily,
  claude: MascotInfo | null,
  codex: MascotInfo | null,
): MascotInfo | null {
  return family === "codex" ? (codex ?? claude) : claude;
}

function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function colorForType(
  type: string,
  overrides: Readonly<Record<string, { color?: string | null }>>,
): string {
  return overrides[type]?.color ?? MINI_COLORS[hashName(type) % MINI_COLORS.length];
}

export function positionKey(mascot: AgentMascot): string {
  return mascot.subagent
    ? `${mascot.family}:type:${mascot.type ?? ""}`
    : `${mascot.family}:project:${mascot.project}`;
}

export type MiniDisplay = "all" | "sessions" | "none";

export function displayed(list: readonly AgentMascot[], mode: MiniDisplay): readonly AgentMascot[] {
  if (mode === "none") return [];
  return mode === "sessions" ? list.filter((mascot) => !mascot.subagent) : list;
}

export const agentMascots = new AgentMascots();
