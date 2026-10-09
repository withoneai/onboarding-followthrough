import { CHECK_FROM_DAY, CHECK_UNTIL_DAY, DEMO, PROJECT_PREFIX, planItems, slackConfigured } from "./config.js";
import { probeAsana } from "./asana.js";
import { probeCalendar } from "./calendar.js";

/**
 * Proves the run will work before you rely on it: the plan parses, and
 * (live only) both connections answer.
 */
let failed = false;

try {
  const items = planItems();
  if (items.length === 0) throw new Error('config/onboarding-plan.md has no "## By day 14" checklist for the model to check against.');
  console.log(`✓ config/onboarding-plan.md parses (${items.length} plan lines)`);
  console.log(`✓ checking hires between day ${CHECK_FROM_DAY} and day ${CHECK_UNTIL_DAY}, projects named "${PROJECT_PREFIX} <hire>"`);

  if (DEMO) {
    console.log("\nNo keys in the environment, so neither connection was probed.");
    console.log("This clone will run `npm start` in demo mode: recorded workspace, real pipeline.");
  } else {
    const projects = await probeAsana();
    console.log(`✓ Asana answers (${projects} onboarding project${projects === 1 ? "" : "s"})`);
    await probeCalendar();
    console.log("✓ Google Calendar answers");
    console.log(slackConfigured() ? "✓ Slack brief configured" : "· Slack brief not configured (optional)");
  }
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
