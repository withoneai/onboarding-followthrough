import { CHECK_FROM_DAY, CHECK_UNTIL_DAY, DEMO, DEMO_REASON, runDate, slackConfigured } from "./config.js";
import { readOnboardingProjects } from "./asana.js";
import { buildHireFacts } from "./facts.js";
import { judgeHire } from "./judge.js";
import { briefText, chaseText, groupChases, postBrief } from "./brief.js";
import type { HireFacts, Judged } from "./types.js";

function parseArgs(argv: string[]): { dryRun: boolean } {
  const args = argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      [
        "Usage:",
        "  npm start                    check every hire in their second to fourth week",
        "  npm start -- --demo          replay the recorded workspace, no keys, no network",
        "  npm start -- --dry-run       print every verdict and chase, post nothing to Slack",
        "",
        `Checks hires between day ${CHECK_FROM_DAY} and day ${CHECK_UNTIL_DAY} (CHECK_FROM_DAY, CHECK_UNTIL_DAY).`,
      ].join("\n"),
    );
    process.exit(0);
  }
  return { dryRun: args.includes("--dry-run") };
}

const opts = parseArgs(process.argv);
const now = runDate();

const demoNote = DEMO ? ` (demo: ${DEMO_REASON}, replaying the recorded workspace)` : "";
console.log(`── onboarding follow-through${demoNote}\n`);
if (DEMO && DEMO_REASON !== "--demo") {
  console.log("   No keys found, so this replays five recorded Asana onboarding projects and");
  console.log("   the recorded calendars of those hires: fictional company, real pipeline.\n");
}

const projects = await readOnboardingProjects();
const inWindow: HireFacts[] = [];
const notJudged: string[] = [];

for (const project of projects) {
  const facts = await buildHireFacts(project, now);
  if ("skipped" in facts) {
    notJudged.push(`${facts.name} (${facts.skipped})`);
  } else if (facts.hire.day < CHECK_FROM_DAY) {
    notJudged.push(`${facts.hire.name} (day ${facts.hire.day}, checked from day ${CHECK_FROM_DAY})`);
  } else if (facts.hire.day > CHECK_UNTIL_DAY) {
    notJudged.push(`${facts.hire.name} (day ${facts.hire.day}, past the window)`);
  } else {
    inWindow.push(facts);
  }
}

console.log(`${projects.length} onboarding projects in Asana, ${inWindow.length} hire${inWindow.length === 1 ? "" : "s"} between day ${CHECK_FROM_DAY} and day ${CHECK_UNTIL_DAY}${opts.dryRun ? " (dry run)" : ""}\n`);

const judged: Judged[] = [];

for (const facts of inWindow.sort((a, b) => b.hire.day - a.hire.day)) {
  const h = facts.hire;
  const done = facts.tasks.filter((t) => t.state === "done" || t.state === "done_late").length;
  const overdue = facts.tasks.filter((t) => t.state === "overdue").length;
  const cal = facts.calendar.visible
    ? `${facts.calendar.events.filter((e) => e.happened).length} meetings held, ${facts.oneOnOnesHeld} 1:1${facts.oneOnOnesHeld === 1 ? "" : "s"} with ${h.manager?.name.split(" ")[0] ?? "the manager"}`
    : `calendar not visible (${facts.calendar.reason})`;
  console.log(`── ${h.name}  day ${h.day}, ${done}/${facts.tasks.length} tasks done, ${overdue} overdue, ${cal}`);

  try {
    const { verdict, dropped } = await judgeHire(facts);
    console.log(`   ${verdict.status.replace("_", " ")}: ${verdict.summary}`);
    for (const g of verdict.gaps) {
      console.log(`   gap ${g.ref}${g.forced ? " (forced)" : ""} -> ${g.owner}: ${g.why}`);
    }
    for (const d of dropped) console.log(`   dropped: ${d}`);
    judged.push({ facts, verdict, dropped });
  } catch (err) {
    console.error(`   failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

if (notJudged.length) console.log(`\nNot checked: ${notJudged.join("; ")}`);

const chases = groupChases(judged);
const count = (s: string) => judged.filter((j) => j.verdict.status === s).length;
console.log(
  `\n${judged.length} checked: ${count("at_risk")} at risk, ${count("slipping")} slipping, ${count("on_track")} on track. ${chases.length} people to chase.`,
);

if (chases.length) {
  console.log("\nChases, drafted (one per person, nothing sent):\n");
  for (const c of chases) {
    console.log(`   to ${c.owner}`);
    console.log(chaseText(c).replace(/^/gm, "     "));
    console.log("");
  }
}

const text = briefText(judged, notJudged);
if (opts.dryRun || DEMO) {
  console.log("The Slack brief this run would post:\n");
  console.log(text.replace(/^/gm, "   "));
}

if (opts.dryRun) {
  console.log("\ndry run: nothing posted to Slack");
} else if (DEMO) {
  console.log("\ndemo mode: nothing was posted to Slack, nothing was sent to anyone");
} else if (slackConfigured()) {
  await postBrief(text);
  console.log("\nposted to Slack");
} else {
  console.log("\nSlack brief not configured (optional)");
}
