import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, forcedGaps, taskFacts } from "./facts.js";
import { validateVerdict } from "./judge.js";
import { toCalendarRead } from "./calendar.js";
import type { RawTask } from "./asana.js";
import type { HireFacts } from "./types.js";

const task = (over: Partial<RawTask>): RawTask => ({
  gid: "1",
  name: "Assign an onboarding buddy",
  completed: false,
  completed_at: null,
  due_on: "2026-09-30",
  assignee: null,
  ...over,
});

test("task state is decided in code against today", () => {
  const [overdue, open, late, ontime] = taskFacts(
    [
      task({}),
      task({ due_on: "2026-10-20" }),
      task({ completed: true, completed_at: "2026-10-02T10:00:00Z", due_on: "2026-09-30" }),
      task({ completed: true, completed_at: "2026-09-29T10:00:00Z", due_on: "2026-09-30" }),
    ],
    "p",
    "2026-10-08",
  );
  assert.equal(overdue.state, "overdue");
  assert.equal(overdue.days, 8);
  assert.equal(open.state, "open");
  assert.equal(late.state, "done_late");
  assert.equal(late.days, 2);
  assert.equal(ontime.state, "done");
  assert.equal(daysBetween("2026-09-28", "2026-10-08"), 10);
});

test("an overdue task with no owner is chased to the manager without asking the model", () => {
  const tasks = taskFacts([task({}), task({ assignee: { gid: "2", name: "Sam" } })], "p", "2026-10-08");
  const gaps = forcedGaps(tasks, { gid: "9", name: "Lena Fischer", email: null });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].owner, "Lena Fischer");
  assert.equal(gaps[0].ref, "T1");
});

function facts(): HireFacts {
  const tasks = taskFacts([task({}), task({ name: "Grant access", assignee: { gid: "2", name: "Sam Okafor" } })], "p", "2026-10-08");
  const manager = { gid: "9", name: "Lena Fischer", email: "lena@x.io" };
  return {
    hire: { projectGid: "p", projectName: "Onboarding: Tomás", projectUrl: "", name: "Tomás Ortega", email: "tomas@x.io", startOn: "2026-09-28", day: 10, manager },
    tasks,
    calendar: { visible: false, reason: "not shared", events: [] },
    oneOnOnesHeld: 0,
    oneOnOnesCancelled: 0,
    forced: forcedGaps(tasks, manager),
  };
}

test("model gaps that point at nothing real are dropped, not kept", () => {
  const { verdict, dropped } = validateVerdict(
    {
      status: "on_track",
      summary: "s",
      gaps: [
        { ref: "T2", owner: "sam okafor", why: "w", chase: "c" },
        { ref: "T9", owner: "Sam Okafor", why: "w", chase: "c" },
        { ref: "T2", owner: "Somebody Else", why: "w", chase: "c" },
        { ref: "E1", owner: "Lena Fischer", why: "w", chase: "c" },
        { ref: "T1", owner: "Lena Fischer", why: "dup of forced", chase: "c" },
      ],
    },
    facts(),
    8,
  );
  assert.deepEqual(
    verdict.gaps.map((g) => `${g.ref}:${g.owner}:${g.forced}`),
    ["T1:Lena Fischer:true", "T2:Sam Okafor:false"],
  );
  assert.equal(dropped.length, 3);
  // An unowned overdue task cannot leave a hire on track.
  assert.equal(verdict.status, "slipping");
});

test("a cancelled 1:1 with its guest list stripped still counts as a cancelled 1:1", () => {
  const read = toCalendarRead(
    [{ id: "a", status: "cancelled", summary: "Tomás / Lena 1:1", start: { dateTime: "2026-09-29T11:00:00Z" }, end: { dateTime: "2026-09-29T11:30:00Z" } }],
    "tomas@x.io",
    { gid: "9", name: "Lena Fischer", email: "lena@x.io" },
    new Date("2026-10-08T15:00:00Z"),
  );
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].managerOneOnOne, true);
  assert.equal(read.events[0].happened, false);
});
