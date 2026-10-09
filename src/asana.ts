import { DEMO, PROJECT_PREFIX, connections, loadFixture, oneClient, teamGid, workspaceGid } from "./config.js";
import type { Person } from "./types.js";

/**
 * Asana has no typed module in @withone/sdk yet, so every call here goes
 * through One's raw passthrough (`runRaw`): same auth, same connection, same
 * retries as a typed call, without generated request and response types. The
 * action ids are Asana's own actions in the One catalog
 * (`one --agent actions find asana "<intent>"`), and each path is the
 * action's path exactly as that catalog lists it.
 *
 * The two list actions are One's composed Asana actions: one call returns
 * every project (or task) with its fields already expanded, so nothing is
 * fetched twice. They take the connection key in the body as well as the
 * header, which is why it appears twice below.
 */
const ACTIONS = {
  listProjects: { id: "conn_mod_def::GGYW_6X8Srw::zl_6Y8oQRQyUqcHvlhoEKA", method: "POST", path: "/v1/asana/get-workspace-projects" },
  listTasks: { id: "conn_mod_def::GGZUz-YDgzg::qe94uYaeSPaGhnvJUHsq3g", method: "POST", path: "/v1/asana/get-project-tasks" },
  getUser: { id: "conn_mod_def::GJ0BqmMOIZI::iAXWLzlHSQabyQC_AsY0ig", method: "GET", path: "/users/{{userGid}}" },
} as const;

export interface RawProject {
  gid: string;
  name: string;
  notes?: string;
  archived?: boolean;
  start_on?: string | null;
  created_at?: string;
  owner?: { gid: string; name?: string } | null;
  permalink_url?: string;
}

export interface RawTask {
  gid: string;
  name: string;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  assignee: { gid: string; name?: string } | null;
  memberships?: Array<{ project?: { gid: string }; section?: { name?: string } | null }>;
  is_rendered_as_separator?: boolean;
  parent?: { gid: string } | null;
  permalink_url?: string;
}

const asana = () => oneClient().connection(connections.asana());

async function listAll<T>(action: (typeof ACTIONS)["listProjects" | "listTasks"], body: Record<string, unknown>, key: "projects" | "tasks"): Promise<T[]> {
  const out: T[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await asana().runRaw({
      systemId: action.id,
      method: action.method,
      path: action.path,
      body: { connectionKey: connections.asana(), limit: 100, ...body, ...(offset ? { offset } : {}) },
    });
    const data = res.data as Record<string, unknown> & { hasMore?: boolean; nextOffset?: string };
    const batch = data[key];
    if (!Array.isArray(batch)) {
      throw new Error(`Asana answered, but not with a list of ${key}.`);
    }
    out.push(...(batch as T[]));
    if (!data.hasMore || !data.nextOffset) break;
    offset = data.nextOffset;
  }
  return out;
}

/**
 * Every unarchived project whose name starts with the onboarding prefix
 * ("Onboarding: Priya Raman"). One project per hire is the shape most
 * people-ops teams already use, usually created from an Asana template.
 */
export async function readOnboardingProjects(): Promise<RawProject[]> {
  const all = DEMO
    ? (loadFixture("asana/projects.json") as RawProject[])
    : await listAll<RawProject>(
        ACTIONS.listProjects,
        { workspaceGid: workspaceGid(), archived: false, ...(teamGid() ? { teamGid: teamGid() } : {}) },
        "projects",
      );
  return all.filter((p) => !p.archived && p.name.toLowerCase().startsWith(PROJECT_PREFIX.toLowerCase()));
}

/** The hire's name, as written after the prefix. */
export function hireNameFrom(project: RawProject): string {
  return project.name.slice(PROJECT_PREFIX.length).replace(/^[\s:\-]+/, "").trim();
}

export async function readTasks(projectGid: string): Promise<RawTask[]> {
  const tasks = DEMO
    ? ((loadFixture("asana/tasks.json") as Record<string, RawTask[]>)[projectGid] ?? [])
    : await listAll<RawTask>(ACTIONS.listTasks, { projectGid }, "tasks");
  // Section headers render as tasks in the list view; they are not work.
  return tasks.filter((t) => !t.is_rendered_as_separator);
}

const people = new Map<string, Person>();

/** Name and email for one Asana user. The email is how the hire's calendar is found. */
export async function readPerson(gid: string): Promise<Person> {
  const cached = people.get(gid);
  if (cached) return cached;
  let person: Person;
  if (DEMO) {
    const users = loadFixture("asana/users.json") as Record<string, Person>;
    person = users[gid] ?? { gid, name: "(unknown user)", email: null };
  } else {
    const res = await asana().runRaw({
      systemId: ACTIONS.getUser.id,
      method: ACTIONS.getUser.method,
      path: ACTIONS.getUser.path,
      pathParams: { userGid: gid },
      query: { opt_fields: "name,email" },
    });
    const data = (res.data as { data?: { gid: string; name?: string; email?: string } }).data;
    person = { gid, name: data?.name ?? "(unknown user)", email: data?.email ?? null };
  }
  people.set(gid, person);
  return person;
}

/** A cheap liveness probe for `npm run check`: the onboarding projects Asana can see. */
export async function probeAsana(): Promise<number> {
  return (await readOnboardingProjects()).length;
}
