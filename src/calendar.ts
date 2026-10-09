import * as gcal from "@withone/sdk/googleCalendar";
import { OneError } from "@withone/sdk";
import { DEMO, connections, loadFixture, oneClient } from "./config.js";
import type { CalendarRead, EventFact, Person, ResponseStatus } from "./types.js";

interface RawEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean }>;
  eventType?: string;
}

const calendar = () => oneClient().connection(connections.googleCalendar());

/**
 * Every event on the hire's own calendar from their start date to now,
 * through the typed `@withone/sdk/googleCalendar` module. Cancelled events
 * are asked for on purpose: a 1:1 that was booked and then cancelled is a
 * different fact from one that was never booked.
 *
 * The connected Google account reads the hire's calendar by email, which
 * works inside a Google Workspace domain where calendars are shared with
 * the organization (the default). When it cannot, the read comes back
 * not-visible with the reason, and the model is told to judge tasks alone.
 */
export async function readHireCalendar(hireEmail: string | null, startOn: string, now: Date): Promise<RawEvent[] | { error: string }> {
  if (!hireEmail) return { error: "no email for the hire in Asana" };
  if (DEMO) {
    const recorded = (loadFixture("calendar/events.json") as Record<string, RawEvent[] | { error: string }>)[hireEmail];
    return recorded ?? { error: "not shared with the connected account" };
  }
  const events: RawEvent[] = [];
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < 10; page++) {
      const res = await calendar().run(
        gcal.listCalendarsEvents({
          path: { calendarId: hireEmail },
          query: {
            timeMin: `${startOn}T00:00:00Z`,
            timeMax: now.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            showDeleted: true,
            maxResults: 250,
            ...(pageToken ? { pageToken } : {}),
          },
        }),
      );
      const data = res.data as { items?: RawEvent[]; nextPageToken?: string };
      events.push(...(data.items ?? []));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  } catch (err) {
    if (err instanceof OneError && (err.status === 403 || err.status === 404)) {
      return { error: "not shared with the connected account" };
    }
    throw err;
  }
  return events;
}

function response(e: RawEvent, hireEmail: string): ResponseStatus {
  if (e.organizer?.email?.toLowerCase() === hireEmail.toLowerCase()) return "organizer";
  const me = e.attendees?.find((a) => a.email?.toLowerCase() === hireEmail.toLowerCase() || a.self);
  const s = me?.responseStatus;
  return s === "accepted" || s === "declined" || s === "tentative" || s === "needsAction" ? s : "unknown";
}

/**
 * Turns raw events into facts, in code: whether each one happened, and
 * whether it was a 1:1 with the manager. Working-location, focus-time and
 * out-of-office blocks are not meetings and are dropped, and so are events
 * with no other person on them.
 */
export function toCalendarRead(raw: RawEvent[] | { error: string }, hireEmail: string | null, manager: Person | null, now: Date): CalendarRead {
  if (!Array.isArray(raw) || !hireEmail) {
    return { visible: false, reason: Array.isArray(raw) ? "no email for the hire" : raw.error, events: [] };
  }
  const managerEmail = manager?.email?.toLowerCase() ?? null;
  const events: EventFact[] = [];
  for (const e of raw) {
    if (e.eventType && e.eventType !== "default") continue;
    const people = (e.attendees ?? []).filter((a) => !a.resource && a.email).map((a) => a.email!.toLowerCase());
    const others = people.filter((p) => p !== hireEmail.toLowerCase());
    const cancelled = e.status === "cancelled";
    // Google often strips the guest list from a cancelled instance, so a
    // cancelled event with a title is kept even when nobody is left on it.
    if (others.length === 0 && !(cancelled && e.summary)) continue;
    const end = e.end?.dateTime ?? e.end?.date;
    const hireResponse = response(e, hireEmail);
    events.push({
      id: `E${events.length + 1}`,
      title: e.summary ?? "(no title)",
      date: (e.start?.dateTime ?? e.start?.date ?? "").slice(0, 10),
      organizer: e.organizer?.displayName ?? e.organizer?.email ?? null,
      attendees: others,
      hireResponse,
      cancelled,
      happened: !cancelled && hireResponse !== "declined" && Boolean(end) && new Date(end!) <= now,
      managerOneOnOne:
        managerEmail !== null &&
        (others.length === 1
          ? others[0] === managerEmail
          : others.length === 0 && looksLikeOneOnOneWith(e.summary ?? "", manager!.name)),
    });
  }
  return { visible: true, reason: null, events };
}

function looksLikeOneOnOneWith(title: string, managerName: string): boolean {
  const first = managerName.split(" ")[0]?.toLowerCase() ?? "";
  return /\b1\s*[:/]\s*1\b|one[- ]on[- ]one/i.test(title) && first.length > 0 && title.toLowerCase().includes(first);
}

/** A cheap liveness probe for `npm run check`: one event on the connected account's own calendar. */
export async function probeCalendar(): Promise<void> {
  await calendar().run(gcal.listCalendarsEvents({ path: { calendarId: "primary" }, query: { maxResults: 1 } }));
}
