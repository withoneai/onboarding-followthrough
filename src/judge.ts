import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CLAUDE_MODEL, DEMO, loadFixture, loadPlan, planItems } from "./config.js";
import { knownOwners } from "./facts.js";
import type { Gap, HireFacts, TaskFact, Verdict } from "./types.js";

export const VerdictSchema = z.object({
  status: z.enum(["on_track", "slipping", "at_risk"]),
  summary: z.string(),
  gaps: z.array(
    z.object({
      ref: z.string(),
      owner: z.string(),
      why: z.string(),
      chase: z.string(),
    }),
  ),
});

type RawVerdict = z.infer<typeof VerdictSchema>;

function task(t: TaskFact): string {
  const owner = t.assignee ?? "nobody";
  const where = t.section ? ` [${t.section}]` : "";
  switch (t.state) {
    case "done":
      return `${t.id}${where} ${t.name}: done ${t.completedOn} (owner ${owner})`;
    case "done_late":
      return `${t.id}${where} ${t.name}: done ${t.completedOn}, ${t.days} ${t.days === 1 ? "day" : "days"} after its ${t.dueOn} due date (owner ${owner})`;
    case "overdue":
      return `${t.id}${where} ${t.name}: NOT DONE, due ${t.dueOn}, ${t.days} ${t.days === 1 ? "day" : "days"} overdue (owner ${owner})`;
    case "open":
      return `${t.id}${where} ${t.name}: not done, due ${t.dueOn}, not due yet (owner ${owner})`;
    case "no_due_date":
      return `${t.id}${where} ${t.name}: not done, no due date (owner ${owner})`;
  }
}

function dayDate(startOn: string, day: number): string {
  return new Date(Date.parse(`${startOn}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
}

export function describe(f: HireFacts, plan: string[] = planItems()): string {
  const h = f.hire;
  const lines = [
    `Hire: ${h.name}`,
    `Started: ${h.startOn} (today is day ${h.day}; day 14 is ${dayDate(h.startOn, 14)}, day 30 is ${dayDate(h.startOn, 30)})`,
    `Manager: ${h.manager?.name ?? "(no project owner in Asana)"}`,
    "",
    "## The plan's lines",
    ...plan.map((p, i) => `P${i + 1} ${p}`),
    "",
    "## Tasks in their Asana onboarding project",
    ...(f.tasks.length ? f.tasks.map(task) : ["(the project has no tasks)"]),
    "",
    "## Their calendar since the start date",
  ];
  if (!f.calendar.visible) {
    lines.push(`NOT VISIBLE: ${f.calendar.reason}. Do not call any meeting missing; judge the tasks alone and say the calendar could not be checked.`);
  } else {
    lines.push(
      `1:1s with the manager: ${f.oneOnOnesHeld} held, ${f.oneOnOnesCancelled} cancelled or declined (counted in code)`,
      ...(f.calendar.events.length
        ? f.calendar.events.map((e) => {
            const state = e.cancelled ? "CANCELLED" : e.hireResponse === "declined" ? "DECLINED by the hire" : e.happened ? "happened" : "upcoming";
            return `${e.id} ${e.date} "${e.title}" with ${e.attendees.join(", ") || "(guest list removed)"}, organized by ${e.organizer ?? "unknown"}: ${state}`;
          })
        : ["(no meetings with anyone since the start date)"]),
    );
  }
  if (f.forced.length) {
    lines.push("", "## Already chased in code (do not repeat these)");
    for (const g of f.forced) lines.push(`${g.ref}: ${g.why} Chasing ${g.owner}.`);
  }
  return lines.join("\n");
}

/**
 * The model's gaps are checked in code before anyone reads them: every gap
 * must point at a task, an event, or a plan line that exists, and name an
 * owner who is actually in the facts. Anything else is dropped and reported,
 * never quietly kept. A gap that repeats a forced one is dropped too.
 */
export function validateVerdict(raw: RawVerdict, facts: HireFacts, planCount: number = planItems().length): { verdict: Verdict; dropped: string[] } {
  const refs = new Set<string>([
    ...facts.tasks.map((t) => t.id),
    ...facts.calendar.events.map((e) => e.id),
    ...Array.from({ length: planCount }, (_, i) => `P${i + 1}`),
  ]);
  const forcedRefs = new Set(facts.forced.map((g) => g.ref));
  const owners = knownOwners(facts);
  const ownerByLower = new Map([...owners].map((o) => [o.toLowerCase(), o]));

  const gaps: Gap[] = [...facts.forced];
  const dropped: string[] = [];
  for (const g of raw.gaps) {
    const ref = g.ref.trim().toUpperCase();
    const owner = ownerByLower.get(g.owner.trim().toLowerCase());
    if (!refs.has(ref)) {
      dropped.push(`${g.ref} is not a task, event, or plan line for ${facts.hire.name}`);
    } else if (forcedRefs.has(ref)) {
      continue;
    } else if (!owner) {
      dropped.push(`${g.owner} is not anyone on ${facts.hire.name}'s onboarding`);
    } else if (!facts.calendar.visible && ref.startsWith("E")) {
      dropped.push(`${ref} is a calendar event, and the calendar was not visible`);
    } else {
      gaps.push({ ref, owner, why: g.why, chase: g.chase, forced: false });
    }
  }
  // The floor: an open, overdue, unowned task cannot leave a hire on track.
  const status = raw.status === "on_track" && facts.forced.length ? "slipping" : raw.status;
  return { verdict: { status, summary: raw.summary, gaps }, dropped };
}

/** The whole instruction for one hire: the plan verbatim, then the facts. */
export function buildPrompt(facts: HireFacts): string {
  return `You are checking one new hire's onboarding at the end of their second week, against our onboarding plan. Follow the plan exactly. Do not re-derive any fact below; they are already established in code. Your job is the judgment: which plan lines are unmet, who has to act, and what to ask them.

## Our onboarding plan

${loadPlan()}

## This hire

${describe(facts)}

## Instructions

- status: "on_track", "slipping", or "at_risk", per the plan's Status section.
- summary: one or two sentences a people-ops lead can read in five seconds, naming the concrete facts that drove the status.
- gaps: one entry per unmet plan line. Empty when there are none.
  - ref: the single best id for the gap. A task id (T3) when there is a task for it; an event id (E2) for a cancelled or declined meeting; a plan line id (P6) when the plan expects something that has no task and no event at all.
  - owner: exactly one name that appears above (the hire, the manager, a task owner, a meeting organizer), or "People ops" when nobody else fits.
  - why: one sentence, the fact that makes it a gap.
  - chase: the message to the owner, written per the plan's "How to write the chase" section, with the due date in it. No greeting and no sign-off: the code adds "Hi <name>," and merges every chase to the same person into one message, so start with the substance.
- Never invent a meeting, a task, a date, or a reason that is not given to you.
- Style: no em dashes or en dashes anywhere. Use a comma, period, colon, or parentheses instead.`;
}

const client = DEMO ? undefined : new Anthropic();

/**
 * Applies the plain-English onboarding plan to one hire's facts. Everything
 * the model sees was established in code: which tasks are overdue and by how
 * much, which meetings happened, how many 1:1s there were. Its job is the
 * judgment those facts cannot make alone: which plan lines are actually
 * unmet, who owes the next move, and the one sentence that gets it moving.
 */
export async function judgeHire(facts: HireFacts): Promise<{ verdict: Verdict; dropped: string[] }> {
  if (DEMO) {
    const recorded = loadFixture("decisions.json") as Record<string, RawVerdict>;
    const raw = recorded[facts.hire.name];
    if (!raw) throw new Error(`No recorded decision for ${facts.hire.name} in fixtures/decisions.json.`);
    return validateVerdict(VerdictSchema.parse(raw), facts);
  }

  const prompt = buildPrompt(facts);

  const response = await client!.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(VerdictSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to judge ${facts.hire.name}.`);
  }
  if (!response.parsed_output) {
    throw new Error("Claude returned output that did not match the schema.");
  }
  return validateVerdict(response.parsed_output, facts);
}
