import * as slack from "@withone/sdk/slack";
import { connections, oneClient, slackChannel } from "./config.js";
import type { Judged, Status } from "./types.js";

export interface Chase {
  owner: string;
  items: Array<{ hire: string; chase: string }>;
}

/**
 * One message per person, not one per gap. An IT lead who owes three hires
 * their access gets one note listing all three, which is the difference
 * between a chase that gets answered and three that get muted.
 */
export function groupChases(judged: Judged[]): Chase[] {
  const byOwner = new Map<string, Chase>();
  for (const j of judged) {
    for (const g of j.verdict.gaps) {
      const chase = byOwner.get(g.owner) ?? { owner: g.owner, items: [] };
      chase.items.push({ hire: j.facts.hire.name, chase: g.chase });
      byOwner.set(g.owner, chase);
    }
  }
  return [...byOwner.values()].sort((a, b) => b.items.length - a.items.length || a.owner.localeCompare(b.owner));
}

export function chaseText(c: Chase): string {
  const first = c.owner.split(" ")[0];
  if (c.items.length === 1) return `Hi ${first}, ${lower(c.items[0].chase)}`;
  const hires = new Set(c.items.map((i) => i.hire));
  const about = hires.size === 1 ? ` for ${[...hires][0]}` : "";
  // Name the hire on a line only when the line itself does not already.
  const line = (i: Chase["items"][number]) =>
    hires.size > 1 && !i.chase.includes(i.hire.split(" ")[0]) ? `• ${i.hire}: ${i.chase}` : `• ${i.chase}`;
  return [`Hi ${first}, ${c.items.length} onboarding items${about} are waiting on you:`, ...c.items.map(line)].join("\n");
}

function lower(s: string): string {
  // Lowercase a leading word only when it is plainly not a name ("Can you..." -> "can you...").
  return /^(Can|Could|Would|Please|The|Your|Their|Our|This|There)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

const STATUS_EMOJI: Record<Status, string> = { at_risk: ":red_circle:", slipping: ":large_orange_circle:", on_track: ":white_check_mark:" };
const STATUS_WORD: Record<Status, string> = { at_risk: "at risk", slipping: "slipping", on_track: "on track" };
const ORDER: Status[] = ["at_risk", "slipping", "on_track"];

export function briefText(judged: Judged[], notJudged: string[]): string {
  const sorted = [...judged].sort((a, b) => ORDER.indexOf(a.verdict.status) - ORDER.indexOf(b.verdict.status));
  const gapCount = judged.reduce((n, j) => n + j.verdict.gaps.length, 0);
  const lines = [
    "*Onboarding follow-through*",
    "",
    `${judged.length} hire${judged.length === 1 ? "" : "s"} checked against the plan, ${gapCount} gap${gapCount === 1 ? "" : "s"} to chase.`,
  ];
  for (const j of sorted) {
    const h = j.facts.hire;
    const link = h.projectUrl ? ` <${h.projectUrl}|plan>` : "";
    lines.push("", `${STATUS_EMOJI[j.verdict.status]} *${h.name}*, day ${h.day}, ${STATUS_WORD[j.verdict.status]}${link}`, `    ${j.verdict.summary}`);
  }
  const chases = groupChases(judged);
  if (chases.length) {
    lines.push("", "*Chases, drafted, not sent*");
    for (const c of chases) lines.push("", `_To ${c.owner}:_`, ...chaseText(c).split("\n").map((l) => `> ${l}`));
  }
  if (notJudged.length) lines.push("", `Not checked: ${notJudged.join("; ")}.`);
  return lines.join("\n");
}

export async function postBrief(text: string): Promise<void> {
  const res = await oneClient()
    .connection(connections.slack())
    .run(slack.sendMessageChannelChatPostmessage({ body: { channel: slackChannel(), text } }));
  const data = res.data as { ok?: boolean; error?: string };
  if (data?.ok === false) {
    throw new Error(`Slack rejected the message: ${data.error}`);
  }
}
