# Signals and waiting

Do not poll in a background loop for a fact outside your own process (a site, a
cloud deploy, another agent's work). Fire and wait on a named signal,
`<project>.<name>`, which shows a card in the conversation and on the Signals
page. Your own long command (a build or test run in the background) stays a
background command: your harness wakes you when it exits.

## `#<project>.<name>` references

A `#<project>.<name>` in a message (`#mdom.released`, picked from `#` in the
composer) names a signal. Take it as the fact the user means you to act on or
wait for:

- When they ask you to wait for it, run `splates signal wait` on that exact
  name with `--timeout` and `--description` (a full sentence naming the fact
  and why it is awaited), adding `--since` when it may have fired already.
- When they say it happened, run `splates signal fire` on it.
- When they ask about its state, the Signals page holds it. A payload is the
  state when it was fired, so re-check before acting on it.
- A name no signal has yet is one nobody has fired or probed, which you may
  still wait on or fire. Never turn it into a polling loop.

## Waiting for a server message

To pause until a task finishes or the local machine stays idle, end the final
agent reply with one directive on its own line:

- `[SPLATES WAIT task <slug>]` waits for a started task in this project to
  merge or be removed. An already finished task answers immediately; an unknown
  task answers that the wait stopped.
- `[SPLATES WAIT machine idle <duration>]` waits for a continuous period below
  the existing machine Busy thresholds. Durations are positive whole numbers
  followed by `ms`, `s`, `m` or `h`, for example `2m`.

The server replies with `[SPLATES WAIT COMPLETE]` and what happened, resuming
this conversation. A task removal is reported as removal, not success: check
what it left before continuing. This notification grants no permission to run
an expensive command or ship; existing permission rules still apply.

These are one-time message requests, independent of signals and subscriptions.
Only the last agent message's final line registers a wait; a newer message
replaces it, and archived conversations are ignored. No page or harness tool is
required. The server checks every five seconds. Pending requests survive a
server restart through conversation history; machine idle time starts over
because the server cannot observe load while stopped. Use blockers for work
that must wait on another task before merging.

Say what you are waiting for and what you will do next before waiting. A
preview server or watcher left available is not a continuation.

## Waiting on an outside condition

- **Fire**: `splates signal fire mdom.released --data '{"version":"2.4.0"}'`
  announces the fact with no approval. Every conversation waiting on that name
  at that moment wakes with the payload; nothing is stored as current truth, so
  fire it when the fact holds. A rig started by splates can run the same
  command from its checkout (including main), attributed to the rig.
- **Wait**:
  `splates signal wait mdom.released --timeout 5h --description "mdom 2.4.0 is published on npm, so vexml can adopt it."`
  puts one card in the conversation, then end your turn. `--description` is
  required: one or two plain sentences a stranger understands, naming the fact
  that holds when it fires and why it is awaited (never a label like "stack
  up"; under 5 words is refused). `--timeout` is required too (7d at most, or 1
  year for clock calls). `--since 5h` (or an ISO time, up to 7 days back) also
  accepts a firing from before you began waiting.
- **Wakeup**: The conversation wakes with `[SPLATES SIGNAL <name>]` and the
  payload when fired, or ending in `timeout`, `stopped` (the user pressed Stop
  waiting), or `removed: <why>` (its source disappeared). On `timeout`, decide
  what to do without the fact, or ask the user.
- **Probe**: For a fact only a check can see (a stack finishing, a page
  changing), attach a probe before waiting, with no approval:
  `splates signal poll aws.stack-ready --interval 5m --timeout 6h --description "The aws stack is up, so the deploy can verify it." -- <script>`.
  The server runs the script in the project's main tree once immediately when a
  wait begins and then every `--interval` (30s at the most often), firing the
  signal with its stdout when it exits 0 after failing. Exit 1 for not yet; any
  other failing exit marks the check broken on the card. It stops when nothing
  waits on it, at its timeout, or when stopped; probing the name again replaces
  it. Then `splates signal wait` on the name.
- **Re-check**: A payload is the state when it was fired, not now: re-check
  before anything hard to undo (a purchase, a cutover, a deploy).
- **Signal functions**: A signal may be a call with JSON5 arguments, such as
  `clock.in("2 days")` or `aws.stack-ready({ stack: "x" })`. A plain value maps
  to the signal function's main field; two spellings of one call are one
  signal. Projects declare signal functions under `signals:` in
  `splates.config.ts`, and waiting on a signal nothing can fire (no standard or
  declared signal function, no probe, no firing in 7 days) is refused.
- **Clock signals**: `clock.in("2 days")`, `clock.at("next monday 9am")`,
  `clock.interval({ interval: "2 days", at: "9am", tz: "America/New_York" })`,
  and `clock.cron({ expr: "0 9 * * 1", tz: "UTC" })` fire automatically while
  subscribed. The machine time zone is the default. Use a `--timeout` long
  enough to reach the firing. Recurring clocks catch up once after downtime.
- **Quota signals**: from the plan limits agents report, the server fires
  `quota.low` when a window reaches 90% used, `quota.unused` in the last 10%
  of its weekly or monthly window while under half is used, and
  `quota.restored` when a window resets, each once per reset. Subscribe bare
  (`quota.unused`) for any agent, pass an agent (`quota.unused("claude")`) for
  one agent, or add `window` (`quota.low({ agent: "claude", window: "seven_day" })`)
  for one window. The payload holds the agent, window, share used, reset time,
  when the agent last reported it, and `lastUserMessageAt` (when someone last
  sent a user message to that agent across all conversations, or `null`).
- **Blockers that close on a signal**: When work cannot start until an outside
  fact holds, do not start it and wait: make the fact a task that closes on its
  signal and block on it. From a task's worktree,
  `splates blocker add --closes-on mdom.released "mdom 2.4.0 on npm"` adds a
  task nobody works and the queue never starts, blocks this task on it, and
  ends it as merged when the signal fires. `splates task add --closes-on <signal>`
  and `splates task update <n> --closes-on <signal>` (or `none`) do the same on
  the board. Only firings after attachment count (`--since` includes earlier
  ones). The board keeps a probe running while the task is open; timeout,
  broken check or expiration never closes it: remove the task to give up.
- **Between agents**: One fires (`splates signal fire`) and another waits
  (`splates signal wait`) on the same name.

## Optional signal expiration

Set automatic removal with `splates signal expire <name> --after 2h` or
`--at 2026-12-01T17:00:00-05:00` (date-only means midnight UTC). `--clear`
cancels expiration. `splates signal expire <name> --on-fire` makes a one-off
signal removed as soon as it fires, once its automations have run. Omitted
expiration leaves a signal unchanged.

The Signals page also edits the deadline. Expiration removes the whole signal,
ends waiting conversations as removed, stops its probe, and pauses automations
on it. It is independent of wait/probe timeouts and firing retention. Deadlines
survive restarts; overdue signals are removed on startup. Raising the name
again creates new activity without reviving its old deadline or paused
automations.

## Cleanup of idle signals

The server hides a signal from the Signals page once nothing has listened to
it or could fire it for 24 hours (no live wait, open task, active or paused
automation, running probe, or deadline), at startup and then hourly;
`splates signal cleanup` runs that sweep now. Hiding is soft: waits and
automations are untouched, and firing, waiting on or probing the signal
again brings it back, as does `splates signal revive <name>` for 30 days.
Agents need not clean up after their own signals.
