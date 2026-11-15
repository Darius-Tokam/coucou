import type { MascotInfo, MascotSlot } from "../core/bridge";
import type { BotStateName } from "../core/layout";

export type MascotFamily = MascotSlot;

export const MINI_LIMIT = 8;
export const LEAVE_MS = 3000;
export const FINISHED_MS = 3000;
export const SLEEP_MS = 120_000;
export const STALE_MS = 1_800_000;

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
  },
  pillId: string,
  project: string,
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
  };
}

export interface AgentMascot {
  key: string;
  family: MascotFamily;
  pillId: string;
  label: string;
  subagent: boolean;
  state: BotStateName;
}

interface TrackedMascot extends AgentMascot {
  lastEventAt: number;
  transitionAt: number | null;
  removeAt: number | null;
  idleAt: number | null;
  sleepAt: number | null;
}

const DEPARTURES = new Set(["SubagentStop", "SessionEnd"]);

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
    if (!mascot && DEPARTURES.has(e.name)) return changed;

    const state = stateFor(e);
    if (!mascot) {
      mascot = {
        key,
        family: e.family,
        pillId: e.pillId,
        label: subagent ? (e.agentType ?? e.project) : e.project,
        subagent,
        state: state ?? "idle",
        lastEventAt: now,
        transitionAt: null,
        removeAt: null,
        idleAt: null,
        sleepAt: null,
      };
      this.entries.push(mascot);
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
    if (DEPARTURES.has(e.name)) {
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

export const agentMascots = new AgentMascots();
