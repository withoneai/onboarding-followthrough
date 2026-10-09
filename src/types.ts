/** A person as Asana knows them: enough to name them and find their calendar. */
export interface Person {
  gid: string;
  name: string;
  email: string | null;
}

/** One onboarding project, read as one hire. */
export interface Hire {
  projectGid: string;
  projectName: string;
  projectUrl: string;
  name: string;
  email: string | null;
  startOn: string;
  day: number;
  manager: Person | null;
}

export type TaskState = "done" | "done_late" | "overdue" | "open" | "no_due_date";

/** One Asana task with its state already worked out in code. */
export interface TaskFact {
  id: string;
  gid: string;
  name: string;
  section: string | null;
  assignee: string | null;
  dueOn: string | null;
  completedOn: string | null;
  state: TaskState;
  /** Days overdue for an open task, days late for a finished one, else 0. */
  days: number;
  url: string;
}

export type ResponseStatus = "accepted" | "declined" | "tentative" | "needsAction" | "organizer" | "unknown";

/** One calendar event on the hire's calendar since their start date. */
export interface EventFact {
  id: string;
  title: string;
  date: string;
  organizer: string | null;
  attendees: string[];
  hireResponse: ResponseStatus;
  cancelled: boolean;
  /** Ended before the run, not cancelled, not declined by the hire. */
  happened: boolean;
  /** Only the hire and their manager on the invite. */
  managerOneOnOne: boolean;
}

export interface CalendarRead {
  /** False when the hire's calendar could not be read (not shared, no access). */
  visible: boolean;
  reason: string | null;
  events: EventFact[];
}

export interface HireFacts {
  hire: Hire;
  tasks: TaskFact[];
  calendar: CalendarRead;
  oneOnOnesHeld: number;
  oneOnOnesCancelled: number;
  /** Gaps established in code before the model is asked anything. */
  forced: Gap[];
}

export interface Gap {
  /** T1, E2 or P3: the task, event, or plan line this gap is about. */
  ref: string;
  owner: string;
  why: string;
  chase: string;
  forced: boolean;
}

export type Status = "on_track" | "slipping" | "at_risk";

export interface Verdict {
  status: Status;
  summary: string;
  gaps: Gap[];
}

export interface Judged {
  facts: HireFacts;
  verdict: Verdict;
  /** Gaps the model returned that pointed at nothing real, dropped in code. */
  dropped: string[];
}
