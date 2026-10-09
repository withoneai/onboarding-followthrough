<h3 align="center">Onboarding Follow-through</h3>
<p align="center">An AI agent for the end of a new hire's second week: read each onboarding project in Asana and the hire's own Google Calendar, have Claude check what actually happened against your onboarding plan, and draft one chase per person for the gaps.<br />Built on <a href="https://withone.ai">One</a>. Nothing is sent, reassigned, or written anywhere; it reads and reports.</p>

<p align="center">
  <a href="https://withone.ai"><strong>Website</strong></a>
  &nbsp;·&nbsp;
  <a href="https://withone.ai/docs"><strong>Docs</strong></a>
  &nbsp;·&nbsp;
  <a href="https://app.withone.ai"><strong>Dashboard</strong></a>
</p>

---

## What it does

Onboarding plans are written carefully and checked by nobody. By day 14 the laptop arrived but production access did not, the manager's first two 1:1s were both moved and then cancelled, the buddy task has no owner, and the benefits form is sitting in an inbox with a deadline that cannot be reopened. Each one is somebody else's small miss, and the hire is the last person who will complain. Run this and it:

1. **Reads every onboarding project from Asana** (one project per hire, named `Onboarding: <name>`, the way most teams already do it from a template) and every task in it.
2. **Works out each task's state in code**: done, done late, overdue by how many days, not due yet. The hire's day number comes from the project's start date.
3. **Reads the hire's own Google Calendar** from their start date to now, including cancelled events, because a 1:1 that was booked and then cancelled is a different fact from one never booked. Code counts the 1:1s with the manager that actually happened.
4. **Routes one gap without asking the model**: an overdue task nobody owns goes straight to the manager. There is no one else to chase, and no wording in a plan should change that.
5. **Has Claude check each hire against your plan**, written in plain English in `config/onboarding-plan.md`: which plan lines are unmet, who owes the next move, and the one message that gets it moving. When the calendar cannot be read, the model is told so and judges the tasks alone.
6. **Checks every gap the model returns, in code**: it must point at a real task, event, or plan line, and name a person who is actually on that hire's onboarding. Anything else is dropped and printed, never quietly kept.
7. **Merges the chases by person and posts one brief to Slack.** An IT lead who owes two hires their access gets one note, not two. The chases are drafts: nothing is sent to anyone.

Sample output (fictional company, shipped as the demo fixture):

```
$ npm start

5 onboarding projects in Asana, 3 hires between day 10 and day 30

── Priya Raman  day 17, 7/8 tasks done, 1 overdue, 9 meetings held, 3 1:1s with Dev
   slipping: One gap, owned by Dev Malhotra: Priya was due to shadow three discovery calls by 2026-10-02, and the calendar shows only one...
── Jordan Lee  day 14, 6/8 tasks done, 2 overdue, calendar not visible (not shared with the connected account, Google answered 404)
   slipping: ...The calendar could not be checked, so these results are based on the Asana tasks only.
── Tomás Ortega  day 10, 3/9 tasks done, 4 overdue, 6 meetings held, 0 1:1s with Lena
   at risk: Tomás's GitHub and production read access is still not granted, 9 days after the 2026-09-29 due date. Both 1:1s with Lena were cancelled...
   gap T4 (forced) -> Lena Fischer: Nobody owns "Assign an onboarding buddy" and it was due 2026-09-30, 8 days ago.
   gap T2 -> Sam Okafor: GitHub and production read access was due 2026-09-29 and is still not granted...

Not checked: Mei Tanaka (day 3, checked from day 10); Chris Ng (day 59, past the window)

3 checked: 1 at risk, 2 slipping, 0 on track. 6 people to chase.

   to Sam Okafor
     Hi Sam, 2 onboarding items for Tomás Ortega are waiting on you:
     • Tomás Ortega still has no GitHub or production read access, which was due 2026-09-29. Can you grant it today, or reply with the date it will be done?
     • Tomás Ortega's first pull request is due 2026-10-10, and it can't happen without the GitHub access that was due 2026-09-29. Could you confirm that access will be in place by 2026-10-09?
```

Every platform call (Asana, Google Calendar, Slack) goes through [One](https://withone.ai): the typed `@withone/sdk` modules for Google Calendar and Slack, and One's raw passthrough for Asana, which has no typed module yet.

## Try it in 60 seconds, no keys

```bash
git clone https://github.com/withoneai/onboarding-followthrough
cd onboarding-followthrough
npm install
npm start
```

With no keys in the environment, the same pipeline runs against five recorded onboarding projects and the recorded calendars of those hires at a fictional 60-person company, with decisions recorded from a real Claude run. Every branch fires at least once: a hire on track except for one missing piece of first work, a hire whose production access never arrived and whose 1:1s were both cancelled, an overdue task with no owner (routed to the manager in code), a hire whose calendar is not shared (judged on tasks alone), a hire too new to check, and one past the window. The demo also prints the Slack brief it would have posted.

## Go live (about 5 minutes)

**1. Connect Asana and Google Calendar through One**

```bash
npm i -g @withone/cli
one init             # create an account or log in
one add asana
one add google-calendar
```

Connect Google Calendar as someone in people ops or an admin. The run reads each hire's calendar by their email, which works inside a Google Workspace domain where calendars are shared with the organization (the default setting). Where a calendar is not visible, that hire is still checked, on tasks alone, and the brief says so.

**2. Configure this repo**

```bash
cp .env.example .env
```

Fill in `ONE_SECRET`, `ANTHROPIC_API_KEY`, the two connection keys from `one --agent list`, and `ASANA_WORKSPACE_GID`. Add `ASANA_TEAM_GID` to look at one team's projects only. Slack is optional: add `ONE_CONNECTION_SLACK` and `SLACK_CHANNEL` when you want the brief posted (`one add slack`).

**3. The onboarding projects**

One Asana project per hire, named `Onboarding: <hire's full name>` (change the prefix with `PROJECT_PREFIX`). What this reads:

| Field | What it is for |
| --- | --- |
| Project start date | The hire's first day. Without it, the earliest task due date stands in |
| Project owner | The manager: the person chased for unowned work, and the other half of a 1:1 |
| Tasks: assignee, due date, completed | Every fact about the plan's tasks |
| A task assigned to the hire | How the hire's email, and so their calendar, is found. Or put their email in the project description |

**4. Write your plan**

`config/onboarding-plan.md` is the whole judgment configuration, in plain English: what should be true by day 14, what counts as a gap, what makes a hire at risk, and how to write a chase. The code that reads Asana and the calendar does not read it; the model applies it verbatim.

**5. Check, then run**

```bash
npm run check         # plan parses, both connections answer
npm start             # read, establish facts, judge, brief
```

## Usage

```bash
# check every hire between day 10 and day 30
npm start

# print every verdict and chase, post nothing to Slack
npm start -- --dry-run

# replay the recorded demo workspace even with keys present
npm start -- --demo

# the code-side gates, without the network
npm test
```

`CHECK_FROM_DAY` (default 10) and `CHECK_UNTIL_DAY` (default 30) set which hires are checked. A weekly run on Thursday catches everyone at the end of week two and keeps chasing until day 30, when the benefits window in the default plan closes.

## What a run costs

One Asana call per 100 projects, one per onboarding project for its tasks, one user lookup per hire and manager, one calendar read per hire, and one Claude call per hire in the window. A company hiring five people a month makes about thirty calls a week. It keeps no state between runs.

## The thing that is easy to get wrong

**Whether a task is overdue is arithmetic. Whether it matters is judgment.** Due dates, days overdue, and whether a 1:1 happened are worked out in code, and the model is never asked to recompute them, because a model that misreads a date chases a manager for something done on Monday. What those facts mean against your plan is the model's job: a late benefits form is a gap, a late security training that is now done is not, and a first pull request that is not due yet is still a gap when the access it needs is nine days overdue.

The other half is who gets chased. The default plan says never chase the hire for something another person owed them, which is the mistake a checklist makes and a person does not. The hire hears about their own benefits form; IT hears about the access.

## How it is wired

| File | What it does |
| --- | --- |
| `config/onboarding-plan.md` | The onboarding plan, in plain English. The model reads it verbatim |
| `src/asana.ts` | Reads onboarding projects, their tasks, and users through One's Asana actions, paged |
| `src/calendar.ts` | Reads the hire's calendar via `@withone/sdk/googleCalendar`; decides which events happened and which were 1:1s |
| `src/facts.ts` | Task states, day numbers, the unowned-task gate |
| `src/judge.ts` | Claude applies the plan to the facts; every returned gap is checked against them |
| `src/brief.ts` | Merges chases by person, builds the brief, posts it via `@withone/sdk/slack` |
| `src/index.ts` | The run: read, establish, gate, judge, brief |
| `src/check.ts` | `npm run check`: the plan parses, connections answer |
| `src/gates.test.ts` | The code-side gates, tested without the network |
| `fixtures/` | The recorded workspace, calendars, and decisions the demo replays |

## What it does not do

- It does not message anyone. The chases are drafts in the brief; a human sends them, or edits them first.
- It does not change Asana. No task is reassigned, commented on, or closed.
- It does not read a calendar it cannot see. Those hires are checked on tasks alone, and the brief says so.
- It does not know your HR system. Payroll and benefits status is whatever the Asana task says.

## License

MIT
