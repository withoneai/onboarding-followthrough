import "dotenv/config";
import { readFileSync } from "node:fs";
import { One } from "@withone/sdk";

/**
 * Demo mode replays a recorded Asana workspace (five onboarding projects) and
 * the recorded calendars of those hires from fixtures/. It turns on two ways:
 * explicitly with --demo, or implicitly when the required keys are absent.
 * The implicit fallback is what makes a fresh clone runnable with zero
 * configuration: the same pipeline runs end to end, only the Asana reads, the
 * calendar reads, and the Claude calls come from disk instead of the wire.
 */
const KEYS_PRESENT = Boolean(
  process.env.ONE_SECRET &&
    process.env.ANTHROPIC_API_KEY &&
    process.env.ONE_CONNECTION_ASANA &&
    process.env.ONE_CONNECTION_GOOGLE_CALENDAR &&
    process.env.ASANA_WORKSPACE_GID,
);

export const DEMO = process.argv.includes("--demo") || !KEYS_PRESENT;
export const DEMO_REASON = process.argv.includes("--demo")
  ? "--demo"
  : KEYS_PRESENT
    ? ""
    : "no keys in the environment";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    console.error("Or run `npm start -- --demo` to replay the recorded workspace, no keys needed.");
    process.exit(1);
  }
  return value;
}

let client: One | undefined;
export function oneClient(): One {
  client ??= new One(required("ONE_SECRET"));
  return client;
}

export const connections = {
  asana: () => required("ONE_CONNECTION_ASANA"),
  googleCalendar: () => required("ONE_CONNECTION_GOOGLE_CALENDAR"),
  slack: () => required("ONE_CONNECTION_SLACK"),
};

export const workspaceGid = () => required("ASANA_WORKSPACE_GID");
export const teamGid = () => process.env.ASANA_TEAM_GID || undefined;
export const PROJECT_PREFIX = process.env.PROJECT_PREFIX || "Onboarding:";

/** Slack is an optional output: configured means both env lines are set. */
export const slackConfigured = () =>
  Boolean(process.env.ONE_CONNECTION_SLACK && process.env.SLACK_CHANNEL);
export const slackChannel = () => required("SLACK_CHANNEL");

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`${name} must be a whole number of days, not "${raw}".`);
    process.exit(1);
  }
  return value;
}

export const CHECK_FROM_DAY = numberEnv("CHECK_FROM_DAY", 10);
export const CHECK_UNTIL_DAY = numberEnv("CHECK_UNTIL_DAY", 30);

export function loadFixture(relPath: string): unknown {
  const url = new URL(`../fixtures/${relPath}`, import.meta.url);
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    throw new Error(`No fixture at fixtures/${relPath}.`);
  }
}

/**
 * "Now" for the run. Live, it is the clock. In demo mode it is pinned to the
 * moment the fixtures were captured, so the recorded hires stay in their
 * second week no matter when you clone the repo.
 */
export function runDate(): Date {
  if (DEMO) {
    const meta = loadFixture("meta.json") as { captured_at: string };
    return new Date(meta.captured_at);
  }
  return new Date();
}

export function loadPlan(): string {
  return readFileSync(new URL("../config/onboarding-plan.md", import.meta.url), "utf8");
}

/**
 * The checklist lines under "## By day 14", numbered P1, P2, ... so the
 * model can point at one and the code can check that it did.
 */
export function planItems(plan: string = loadPlan()): string[] {
  const lines = plan.split("\n");
  const start = lines.findIndex((l) => /^##\s+By day/i.test(l));
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (line.startsWith("- ")) items.push(line.slice(2).trim());
  }
  return items;
}
