import type { Logger } from "@webappwiz/log";
import type { Fs } from "@webappwiz/sys";
import { age } from "./age";
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

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
};

const esc = (text: string): string =>
	text.replace(/[&<>]/g, (char) => ENTITIES[char] ?? char);

const STYLE = `
:root { color-scheme: light dark }
body { font: 13px ui-monospace, monospace; max-width: 100rem; margin: 2rem auto; padding: 0 1rem }
h1, h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .1em; opacity: .6; margin-top: 0 }
main { display: grid; gap: 0 2rem; align-items: start }
/* Tasks carry a TODO.md and want the room; the log is four narrow columns.
   Below this the two would each be too cramped to read, so they stack. */
@media (min-width: 72rem) { main { grid-template-columns: minmax(0, 1fr) max-content } }
details { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 4px; padding: .5rem .75rem; margin: .5rem 0 }
summary { cursor: pointer }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 0 1rem; margin: .5rem 0 }
dt { opacity: .6 }
dd { margin: 0 }
pre { background: color-mix(in srgb, currentColor 7%, transparent); padding: .75rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap }
table { border-collapse: collapse }
td { padding: .15rem 1.5rem .15rem 0 }
.added { color: #2a2 } .removed { color: #c33 } .ok { color: #2a2 } .warn { color: #b80 }
.quiet { opacity: .6 }
`;

function page({ tasks, entries }: Snapshot): string {
	return `<!doctype html>
<meta charset="utf-8">
<title>arbor</title>
<link rel="icon" href="data:,">
<style>${STYLE}</style>
<main>
<section>
<h1>tasks</h1>
${
	tasks.length === 0
		? `<p class="quiet">no tasks: run <code>arbor add &lt;task&gt;</code> to start one</p>`
		: tasks.map(card).join("\n")
}
</section>
<section>
<h2>log</h2>
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
	const fields = [
		`<dt>branch<dd>${esc(details.branch)}`,
		`<dt>base<dd>${esc(details.base)}`,
		`<dt>worktree<dd>${esc(details.worktree)}`,
	];
	if (details.escalation !== null) {
		fields.push(`<dt>escalated<dd class="warn">${esc(details.escalation)}`);
	}
	return `<details open>
<summary><b>${esc(details.task)}</b> ${esc(details.status)} lease:${esc(details.lease)} ahead:${details.ahead ?? "?"} ${diff(details)} ${esc(details.age ?? "?")}</summary>
<dl>${fields.join("\n")}</dl>
${todo(details)}
</details>`;
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
	return `<pre>${esc(details.todo.trimEnd())}</pre>${problems}`;
}

function row(entry: Entry): string {
	const result =
		entry.reason === null
			? `<td class="ok">ok`
			: `<td class="warn">${esc(entry.reason)}`;
	return `<tr><td>${esc(age(entry.at))}<td>${esc(entry.action)}<td>${esc(entry.task ?? "-")}${result}`;
}
