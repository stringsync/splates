---
name: rec
description: Read a rec session (a narrated bug recording), by folder or by a `#rec:<name>` reference, and drive rec's Chrome with Playwright over CDP to reproduce or investigate. Use when given a rec session folder or a `#rec:<name>` reference, asked to act on a recording, or asked to look at or work in the page rec has open.
---

# rec

`rec` records a person browsing in its own Chrome and writes a session folder
an agent can act on without watching video. Run it from the mono root as
`bin/rec`. Its design is in `rec/AGENTS.md`.

## Reading a session folder

A `#rec:<name>` reference in a message names a session: run
`bin/rec sessions path <name>` to get its folder. If rec answers that the
session is not on this device, say so, carry on without it, and do not offer
rec again in that conversation.

If the session's `manifest.json` has `processing`, its transcript and moments
are not written yet:

- `"pending"`: rec is still writing them, or has not yet. Check
  `bin/rec status --json`. When it lists the session under `processing`, wait a
  minute and read again. When it does not and the folder has a
  `transcript.json`, run `bin/rec transcribe <dir> --reuse` yourself: it keeps
  that transcript and pays nothing. When it does not and there is no
  `transcript.json`, ask the user to approve `bin/rec transcribe <dir>` with a
  run-command card, since it pays for whisper; never run it unasked.
- `"failed"`: tell the user its `reason` and the `retry` command it gives.

Read in this order, stopping when you know enough:

1. `moments.md`: the ranked moments where the app was probably not working,
   each with what was said, the signals behind it and related log lines. Start
   with the top ones. With no `TYPESAFE_API_KEY` it ranks by code signals only
   and says so.
2. `timeline.md`: the whole session in video time: narration (spoken lines,
   `remark:` for agent marks, `typed remark:` for what the person typed instead of saying), clicks, route changes, alerts, and pointers
   to `frames/` stills and `logs/*.log` by 10-second window (line numbers and
   error counts, not copies).
3. `frames/`: stills cut at each click, highlight and mark. Open the ones a
   moment or timeline line names.
4. The `logs/` windows the timeline points at (`console.log`, `network.log`,
   and any `docker-*.log` or `tail-*.log`). Read only the named line ranges.

Deeper only if needed: `moments.jsonl` (raw signals and answers),
`events.jsonl`, `manifest.json` (start time, wall-clock ms = video time 0;
`noMic: true` means no transcript is expected), `recording.webm` (do not
watch it). Logs are scrubbed, so a `[REDACTED:<NAME>]` is not a bug.
`bin/rec moments <dir> --about "<text>"` re-ranks against a question.

## Seeing a moment

When you reference, or act on, a moment of a session (one from `moments.md`,
a timeline line, or a time the person gave), look at it before you decide
anything: do not guess from text alone. Cut the slice:

    bin/rec slice <name> --moment <n>      # a ranked moment, whole span
    bin/rec slice <name> --at 1:23         # video time: seconds or m:ss

Both pad 5 s before and after (`--before`, `--after`), and print the paths
(`--json` for a program): `slices/<time>/clip.mp4` (silent) and up to a dozen
`shot-*.jpg` stills, one second apart, the one at the exact moment ending
`-at.jpg`. Open the `-at` still first, then the neighbours to see what
changed. Do not read `recording.webm` itself. When you hand a moment to
another agent or the person, give the slice paths with it.

## Turning a session into work

A session read for its findings (a "Send to an agent" hand-off, or a request to
act on a recording) ends in a list of tasks to choose from, not in an
investigation and not in started work. Do not offer to "investigate X first":
see each moment (above), then:

1. List one candidate task per distinct finding, each with a name and what done
   means. A behaviour that is working as designed (a validation the person
   missed) is a clarity task, or nothing.
2. Ask which to keep as one numbered question with `- (a)`, `- (b)` choices
   (all that apply), the ones you recommend marked `(chosen)`, and say the kept
   ones become one lane. End your turn.
3. After the answer, run `splates lane add` and put only the kept tasks in it.
   Each task's Before cites the video time and the slice paths of its moment;
   order dependencies inside the lane. Start none of them.
4. End the reply with that lane's one queue card (`splates lane queue <n>`).

## Starting a recording

Only a person can start a recording: `bin/rec` opens Chrome *staged*, and
nothing records until Start is pressed in the control panel (Chrome's side
panel). There is no command that starts or stops one.

**An agent never launches rec without the person's approval.** Ask with a
run-command permission card (`## 🔐 Permission: run command: <why>`) naming
the exact command, whether or not the machine is busy, end the turn, and run
it only on `[SPLATES RUN ALLOWED]`. If the answer is that they are not at that
machine (`[SPLATES RUN ELSEWHERE]`) or they decline, carry on without rec and
do not offer it again in that conversation. This is a rule agents follow, not
a lock: nothing stops an agent running the command itself, so keep to it.

1. Once approved, run `bin/rec` in the background (it stays up until Ctrl-C), from the folder
   whose `.env*` and Docker project should be scrubbed and followed. Flags:
   - `--url <url>`: what the working window opens on (default `about:blank`);
     pass the page to reproduce on.
   - `--no-mic`: no audio and no OpenAI key; use it when the agent, not the
     person, narrates. Without it the mic records normally. `OPENAI_API_KEY` is optional:
     without it, audio stays in the recording, the timeline and moments are
     written without speech, and the manifest explains the missing transcript.
     Set the key and run `bin/rec transcribe <dir>` later to add speech.
   - `--out <dir>`: the session folder (default `~/Desktop/rec/<time>`).
   - `--docker[=<ids or names>]` and `--tail <path>[@-5m]`: also follow
     container or file logs into `logs/`. `bin/rec sources` lists what exists.
2. It is ready when its output says `staged:` and `bin/rec sources` lists the
   working tab. If Chrome 136+ or the profile is the problem, say what rec
   printed; do not launch another browser.
3. Recording begins at Start, which can be pressed any number of times: each
   Stop saves a session folder. `bin/rec mark` works only between Start and
   Stop.
4. Stop in the panel saves the folder and then transcribes and ranks it, so
   `moments.md` and `timeline.md` appear a little later. Closing Chrome does
   not end rec; Ctrl-C (or Stop on the splates rec page) ends it once pending
   processing is done, and a second Ctrl-C quits at once, leaving it for the
   next start. Read the folder only once `manifest.json` lists `timeline` and
   `momentsReport` under `files`. The folder path is in rec's output
   (`saved <dir>`).

## Asking a person to reproduce something

When the person must do the steps (a bug only they can trigger, or a judgment
about how it feels), hand them the window rather than driving it:

- Start rec (above) with `--url` on the right page, then tell them in a few
  lines: the rec Chrome window is open; press **Start** in the side panel; do
  the steps, saying aloud what they expect and what goes wrong (or, with
  `--no-mic`, nothing: you narrate); hold **Option** and drag to circle
  anything on the page; press **Stop** when done.
- Name the exact steps to try, one per line, and the failure to watch for, so
  their narration lines up with the moments rec ranks.
- While they work, you may `bin/rec mark "<text>"` to note context ("user
  starts checkout"), but do not drive the tab or they will fight you.
- Wait for them to say they pressed Stop, then read the session as above.
- Their typing is logged as where it went, never the text, so ask them to
  say aloud anything you need that was typed.

## Attaching to rec's Chrome

When rec is running, drive its Chrome rather than launching a browser: the
profile in `~/.rec/chrome` and the page the person was on are kept. Use only
Playwright (`playwright-core`) and CDP, no other tool.

- `bin/rec sources` lists the open tabs (`none: rec's Chrome is not open` when
  it is closed). If it is closed, say so and ask the person to start `bin/rec`
  instead of launching Chrome yourself.
- rec starts Chrome with `--remote-debugging-port=0`, so the port is random
  each run. Read it from `~/.rec/chrome/DevToolsActivePort` (line 1 is the
  port, line 2 the browser socket path). The file can be left over from a
  closed Chrome, so check `bin/rec sources` first.
- Attach with `chromium.connectOverCDP("http://127.0.0.1:<port>")`, take
  `browser.contexts()[0]`, and pick the working page by URL from
  `context.pages()`. Skip the control panel (served from `localhost`, its
  paths under `/__rec/`) and any extension page.

```ts
import { chromium } from "playwright-core";
const [port] = (await Bun.file(`${process.env.HOME}/.rec/chrome/DevToolsActivePort`).text()).split("\n");
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages().find((p) => !p.url().includes("/__rec/") && !p.url().startsWith("http://localhost"));
```

`browser.close()` on a CDP connection only disconnects; it does not quit
Chrome. Never call `browserContext.close()` or close the person's tabs.

What was checked (a headless Chrome with rec's flags, a raw-CDP
`Page.startScreencast` client like rec's, and Playwright attached at the same
time): a second client on the screencast tab causes no problem. Frames kept
arriving while Playwright navigated, clicked and took screenshots, and
`newPage()` worked. rec's own Chrome with its side panel extension was not
spiked; if something there misbehaves, say what you saw rather than work
around it by launching another browser. Do not call
`page.setViewportSize` or other emulation overrides, which resize the page
under the screencast.

## Driving the working tab

Drive the working tab freely: navigate, click, type, read the DOM. What you do
is recorded and the noise is accepted; do not try to hide it.

- Run `bin/rec --no-mic` for an agent-only recording: no audio, no whisper, no
  OpenAI key.
- Narrate as you go with `bin/rec mark "<text>"`: it stamps the moment, adds a
  still, and ranks like a spoken line. Mark what you are about to try and what
  you see, especially a failure ("clicked Save, got a 500 toast"). One mark
  per step, plain text, no secrets.
- `bin/rec mark` needs a recording in progress (it finds the server through
  `~/.rec/server.json`); it fails otherwise.
- Do not run `bin/rec bench`: it keeps cores busy for ten minutes. Ask first.
