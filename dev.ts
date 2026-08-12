import type { Logger } from "@webappwiz/log";
import { Markdown } from "@webappwiz/md";
import type { Fs } from "@webappwiz/sys";
import { age } from "./age";
import { esc, render } from "./html";
import type { Entry, Journal } from "./journal";
import { DEFAULT_COUNT } from "./log";
import { type Details, taskDetails } from "./show";
import type { WorktreeStore } from "./worktree-store";

export const DEFAULT_PORT = 4269;

/** How often the repo is re-read to decide whether open pages should reload. */
const POLL_MS = 2_000;

/** A running server, and the one thing a caller ever wants to do with it. */
export interface DevServer {
	port: number;
	stop: () => void;
}

/** Everything one page shows: `ls` and `show` for each task, plus `log`. */
interface Snapshot {
	tasks: Details[];
	entries: Entry[];
}

/**
 * Serves what `ls`, `show` and `log` print, as one page that reloads itself
 * when the repo changes. Read-only on purpose: driving arbor is what the CLI
 * is for, and a button that took a lease would fight the agent holding it.
 */
export async function dev(
	{
		store,
		fs,
		journal,
		log,
	}: { store: WorktreeStore; fs: Fs; journal: Journal; log: Logger },
	{ port = DEFAULT_PORT } = {},
): Promise<DevServer> {
	const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
	const encoder = new TextEncoder();
	let last = fingerprint(await snapshot(store, fs, journal));

	// ponytail: polls, because arbor's state is spread across records, git refs
	// and TODO.md, and one watcher would not cover all three. Watch `.git/arbor`
	// and the worktree roots if two seconds ever feels slow.
	const tick = async (): Promise<void> => {
		const print = fingerprint(await snapshot(store, fs, journal));
		if (print === last) {
			return;
		}
		last = print;
		for (const stream of open) {
			stream.enqueue(encoder.encode("data: changed\n\n"));
		}
	};
	const poll = setInterval(() => {
		tick().catch((error: unknown) => log.error(String(error)));
	}, POLL_MS);

	const server = Bun.serve({
		port,
		// An SSE stream is idle by design between changes, and Bun would otherwise
		// close it after ten seconds.
		idleTimeout: 0,
		routes: {
			"/": async () =>
				new Response(page(await snapshot(store, fs, journal)), {
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
			"/events": () => {
				let self: ReadableStreamDefaultController<Uint8Array> | null = null;
				return new Response(
					new ReadableStream<Uint8Array>({
						start: (stream) => {
							self = stream;
							open.add(stream);
							// A comment, ignored by EventSource. Without a first chunk the
							// response headers never reach the client and the page hangs
							// waiting to connect.
							stream.enqueue(encoder.encode(": connected\n\n"));
						},
						cancel: () => {
							if (self) {
								open.delete(self);
							}
						},
					}),
					{
						headers: {
							"content-type": "text/event-stream",
							"cache-control": "no-cache",
						},
					},
				);
			},
		},
	});

	// Undefined only for a unix socket, which this never asks for. Reading it
	// back matters for `--port 0`, where the port is whatever was free.
	const listening = server.port ?? port;
	log.info(`arbor dev on http://localhost:${listening}`);
	return {
		port: listening,
		stop: () => {
			clearInterval(poll);
			void server.stop(true);
		},
	};
}

async function snapshot(
	store: WorktreeStore,
	fs: Fs,
	journal: Journal,
): Promise<Snapshot> {
	const tasks: Details[] = [];
	for (const worktree of await store.list()) {
		tasks.push(await taskDetails(worktree, fs));
	}
	return { tasks, entries: await journal.tail(DEFAULT_COUNT) };
}

/**
 * What the page is actually showing, minus the fields that move on their own.
 * `age` ticks every minute, and hashing it would reload every open page for
 * nothing.
 */
function fingerprint({ tasks, entries }: Snapshot): string {
	return JSON.stringify([
		tasks.map((task) => [
			task.task,
			task.status,
			task.lease,
			task.ahead,
			task.added,
			task.removed,
			task.escalation,
			task.todo,
			task.todoProblems,
		]),
		entries.length,
		entries.at(-1)?.at ?? null,
	]);
}

const STYLE = `
:root { color-scheme: light dark }
body { font: 13px ui-monospace, monospace; max-width: 72rem; margin: 2rem auto; padding: 0 1rem }
/* The tab lives in the URL hash rather than in CSS or a variable, because the
   page reloads itself on every push and anything else would snap back to
   tasks each time. No hash means tasks, so that is what the plain rules say
   and the :has rules override. */
nav { display: flex; gap: 1.5rem; margin-bottom: 1rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .1em }
nav a { color: inherit; text-decoration: none; opacity: .4 }
nav a[href="#tasks"] { opacity: 1 }
#log { display: none }
body:has(#log:target) #tasks { display: none }
body:has(#log:target) #log { display: block }
body:has(#log:target) nav a[href="#tasks"] { opacity: .4 }
body:has(#log:target) nav a[href="#log"] { opacity: 1 }
article, details { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 4px; padding: .5rem .75rem; margin: .5rem 0 }
summary { cursor: pointer }
.head { margin: 0 }
/* An escalated task is waiting on the person reading this page. A yellow
   accent edge and head are enough to say so; the card itself stays quiet. */
article.escalated { border-left: 3px solid #b80 }
article.escalated .head { color: #b80 }
.banner { border-left: 3px solid #b80; padding: .4rem .75rem; margin: .5rem 0; background: color-mix(in srgb, #b80 7%, transparent) }
.banner b { font-weight: normal; color: #b80 }
.badge { display: inline-block; padding: 0 .45rem; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; font-weight: normal; opacity: .7 }
.badge.needs { border-color: #b80; background: color-mix(in srgb, #b80 10%, transparent); color: #b80; opacity: 1 }
.badge.broken { border-color: #c33; background: color-mix(in srgb, #c33 18%, transparent); color: #c33; opacity: 1 }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 0 1rem; margin: .5rem 0 }
dt { opacity: .6 }
dd { margin: 0 }
pre { background: color-mix(in srgb, currentColor 7%, transparent); padding: .75rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap }
table { border-collapse: collapse }
td { padding: .15rem 1.5rem .15rem 0 }
.bar { display: inline-block; vertical-align: middle; width: 6rem; height: .45rem; border-radius: 999px; background: color-mix(in srgb, currentColor 18%, transparent); overflow: hidden }
.bar i { display: block; height: 100%; background: #2a2 }
.added { color: #2a2 } .removed { color: #c33 } .ok { color: #2a2 } .warn { color: #b80 }
.quiet { opacity: .6 }
/* A rendered TODO.md. It sits on the card rather than in a border of its own:
   a box inside a box reads as busy, and the label and spacing separate it
   well enough. Its headings are section labels rather than titles, so they
   read as the dt/badge lettering above them does. */
.todo { margin: .75rem 0 }
.todo :is(h3, h4, h5, h6) { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; opacity: .55; margin: .9rem 0 .3rem }
.todo > :first-child { margin-top: 0 }
.todo p { margin: .3rem 0 }
.todo ul { list-style: disc; padding-left: 1.2rem; margin: .3rem 0 }
/* Checklist items give up the bullet to the checkbox and pull back into the
   space it left. */
.todo li.box { list-style: none; margin-left: -1.2rem }
/* A ticked box says done on its own: striking the text through as well turns a
   long Done section into a wall of crossed-out lines. */
.todo li.box:has(input:checked) { opacity: .5 }
.todo input { margin: 0 .35rem 0 0; vertical-align: -.1em }
.todo code { background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 3px; padding: 0 .25rem }
.todo pre code { background: none; padding: 0 }
`;

function page({ tasks, entries }: Snapshot): string {
	return `<!doctype html>
<meta charset="utf-8">
<title>arbor</title>
<link rel="icon" href="data:,">
<style>${STYLE}</style>
<nav><a href="#tasks">tasks</a><a href="#log">log</a></nav>
<main>
<section id="tasks" aria-label="tasks">
${
	tasks.length === 0
		? `<p class="quiet">no tasks: run <code>arbor add &lt;task&gt;</code> to start one</p>`
		: tasks.map(card).join("\n")
}
</section>
<section id="log" aria-label="log">
${
	entries.length === 0
		? `<p class="quiet">nothing recorded yet</p>`
		: `<table>${entries.map(row).join("")}</table>`
}
</section>
</main>
<script>new EventSource("/events").onmessage = () => location.reload()</script>
`;
}

function card(details: Details): string {
	const escalated = details.status === "escalated";
	// The reason is the whole point of an escalated card, so it goes above the
	// fields rather than into the run of them.
	const banner =
		details.escalation === null
			? ""
			: `<p class="banner"><b>needs you</b> ${esc(details.escalation)}</p>`;
	return `<article${escalated ? ` class="escalated"` : ""}>
<p class="head"><b>${esc(details.task)}</b> ${badge(details.status)} ${bar(details)} ahead:${details.ahead ?? "?"} ${diff(details)} ${esc(details.age ?? "?")}</p>
${banner}
<dl><dt>branch<dd>${esc(details.branch)}
<dt>base<dd>${esc(details.base)}
<dt>worktree<dd>${esc(details.worktree)}
<dt>lease<dd>${esc(details.lease)}</dl>
${todo(details)}
</article>`;
}

/** A tree in one of these needs fixing rather than driving. */
const BROKEN = new Set(["orphaned", "stray", "unrecorded", "unknown"]);

/**
 * Three tones rather than one per status: normal, waiting on a person, and
 * broken. Any more and the colour stops meaning anything.
 */
function badge(status: string): string {
	const tone =
		status === "escalated" ? " needs" : BROKEN.has(status) ? " broken" : "";
	return `<span class="badge${tone}">${esc(status)}</span>`;
}

function diff(details: Details): string {
	if (details.added === null || details.removed === null) {
		return "?";
	}
	return `<span class="added">+${details.added}</span> <span class="removed">-${details.removed}</span>`;
}

function todo(details: Details): string {
	if (details.todo === null) {
		return details.status === "orphaned"
			? ""
			: `<p class="warn">no TODO.md: whoever picks this up starts from the diff</p>`;
	}
	const problems = details.todoProblems
		.map((problem) => `<p class="warn">${esc(problem)}</p>`)
		.join("");
	// The card's summary already carries the task name, so the document's own
	// title would only say it a second time.
	const body = details.todo.replace(/^\s*#\s[^\n]*/, "");
	return `<div class="todo"><p class="quiet">TODO.md</p>${render(body)}</div>${problems}`;
}

const BOX = /^[ \t]*- \[([ xX])\]/gm;

/** The sections that hold the work, so a checklist under Notes cannot skew it. */
const WORK = ["Done", "Next"];

/**
 * How far along the task is, counted off the `TODO.md` checkboxes rather than
 * anything arbor records: the agent moving an item to `## Done` is the only
 * signal there is that a step finished.
 */
function bar(details: Details): string {
	if (details.todo === null) {
		return "";
	}
	const md = Markdown.parse(details.todo);
	const boxes = WORK.flatMap((name) =>
		md.has(name) ? [...md.section(name).body.matchAll(BOX)] : [],
	);
	if (boxes.length === 0) {
		return "";
	}
	const done = boxes.filter((box) => box[1] !== " ").length;
	const percent = Math.round((done / boxes.length) * 100);
	return `<span class="bar" role="img" aria-label="${done} of ${boxes.length} done"><i style="width:${percent}%"></i></span> <span class="quiet">${done}/${boxes.length}</span>`;
}

function row(entry: Entry): string {
	const result =
		entry.reason === null
			? `<td class="ok">ok`
			: `<td class="warn">${esc(entry.reason)}`;
	return `<tr><td>${esc(age(entry.at))}<td>${esc(entry.action)}<td>${esc(entry.task ?? "-")}${result}`;
}
