import { readHireCalendar, toCalendarRead } from "./calendar.js";
import { hireNameFrom, readPerson, readTasks, type RawProject, type RawTask } from "./asana.js";
import type { Gap, Hire, HireFacts, Person, TaskFact, TaskState } from "./types.js";

const DAY_MS = 86_400_000;

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** When the hire started: the project's start date, else the first task's, else when the project was made. */
export function startDateOf(project: RawProject, tasks: RawTask[]): string | null {
  if (project.start_on) return project.start_on;
  const dues = tasks.map((t) => t.due_on).filter((d): d is string => Boolean(d)).sort();
  if (dues.length) return dues[0];
  return project.created_at ? project.created_at.slice(0, 10) : null;
}

/** Every task's state, decided in code against today's date. */
export function taskFacts(tasks: RawTask[], projectGid: string, today: string): TaskFact[] {
  return tasks
    .filter((t) => !t.parent)
    .map((t, i) => {
      const completedOn = t.completed_at ? t.completed_at.slice(0, 10) : null;
      let state: TaskState;
      let days = 0;
      if (t.completed) {
        days = t.due_on && completedOn ? Math.max(0, daysBetween(t.due_on, completedOn)) : 0;
        state = days > 0 ? "done_late" : "done";
      } else if (!t.due_on) {
        state = "no_due_date";
      } else if (t.due_on < today) {
        state = "overdue";
        days = daysBetween(t.due_on, today);
      } else {
        state = "open";
      }
      const section = t.memberships?.find((m) => m.project?.gid === projectGid)?.section?.name ?? null;
      return {
        id: `T${i + 1}`,
        gid: t.gid,
        name: t.name,
        section: section && section !== "Untitled section" ? section : null,
        assignee: t.assignee?.name ?? null,
        dueOn: t.due_on,
        completedOn,
        state,
        days,
        url: t.permalink_url ?? "",
      };
    });
}

/**
 * The one gap that never goes to the model: an overdue task nobody owns.
 * There is no one to chase but the manager, and no wording in a plan should
 * be able to talk a model out of saying so.
 */
export function forcedGaps(tasks: TaskFact[], manager: Person | null): Gap[] {
  const owner = manager?.name ?? "People ops";
  return tasks
    .filter((t) => t.state === "overdue" && !t.assignee)
    .map((t) => ({
      ref: t.id,
      owner,
      why: `Nobody owns "${t.name}" and it was due ${t.dueOn}, ${t.days} day${t.days === 1 ? "" : "s"} ago.`,
      chase: `"${t.name}" has no owner in Asana and was due ${t.dueOn}. Can you assign it to someone today?`,
      forced: true,
    }));
}

/** Reads one onboarding project and the hire's calendar, and establishes every fact the model will see. */
export async function buildHireFacts(project: RawProject, now: Date): Promise<HireFacts | { skipped: string; name: string }> {
  const name = hireNameFrom(project);
  const raw = await readTasks(project.gid);
  const startOn = startDateOf(project, raw);
  if (!startOn) return { skipped: "no start date on the project or its tasks", name };

  const today = isoDay(now);
  const manager = project.owner?.gid ? await readPerson(project.owner.gid) : null;

  // The hire is the person in the project whose name matches the project title.
  const hireTask = raw.find((t) => t.assignee?.name?.toLowerCase() === name.toLowerCase());
  const hirePerson = hireTask?.assignee ? await readPerson(hireTask.assignee.gid) : null;
  const email = hirePerson?.email ?? project.notes?.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;

  const hire: Hire = {
    projectGid: project.gid,
    projectName: project.name,
    projectUrl: project.permalink_url ?? "",
    name,
    email,
    startOn,
    day: daysBetween(startOn, today),
    manager,
  };

  const tasks = taskFacts(raw, project.gid, today);
  const calendar = toCalendarRead(await readHireCalendar(email, startOn, now), email, manager, now);
  const ones = calendar.events.filter((e) => e.managerOneOnOne);

  return {
    hire,
    tasks,
    calendar,
    oneOnOnesHeld: ones.filter((e) => e.happened).length,
    oneOnOnesCancelled: ones.filter((e) => e.cancelled || e.hireResponse === "declined").length,
    forced: forcedGaps(tasks, manager),
  };
}

/** Everyone the model may name as an owner: the hire, the manager, every assignee, and People ops. */
export function knownOwners(facts: HireFacts): Set<string> {
  const names = new Set<string>(["People ops", facts.hire.name]);
  if (facts.hire.manager) names.add(facts.hire.manager.name);
  for (const t of facts.tasks) if (t.assignee) names.add(t.assignee);
  for (const e of facts.calendar.events) if (e.organizer) names.add(e.organizer);
  return names;
}
