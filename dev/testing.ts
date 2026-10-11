// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "../../../setup";
import { expect } from "bun:test";
import { createElement } from "react";
import type { Resource } from "webappwiz/disposable";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import type { Interrupted, ProjectChoice } from "./api";

// Loaded only once the DOM above is in place, and handed on from here so a test
// file need not load them itself. Bun loads a package's CommonJS while it links
// the static imports, before even this file's own `setup` import has run, and
// react-dom decides at load time whether the browser has `input` events:
// loaded too early, it concludes it does not, and no `onChange` ever fires.
export const { act, cleanup, fireEvent, render, waitFor, within } =
	await import("@testing-library/react");
const { App } = await import("./app");

/** A write the page made. */
export interface Post {
	path: string;
	method: string;
	body: BodyInit | null | undefined;
}

/** The handlers `Feed` sets on its `EventSource`, for a test to call. */
export interface Stream {
	onmessage: ((event?: { data: string }) => void) | null;
	onopen: (() => void) | null;
	onerror: (() => void) | null;
}

/**
 * The server the dev page runs against, faked in place of `fetch` and
 * `EventSource` from construction until `dispose`.
 *
 * The page never touches arbor: it reads a `Snapshot` the server already
 * assembled and writes todos. So the fake is the snapshot and a record of the
 * posts, and none of these tests need a repo, a worktree or the CLI.
 * `dev.test.ts` covers the half that does.
 */
export class Testing implements Resource {
	/** What the page reads; a test sets it before the page fetches again. */
	served: Snapshot = snapshot();
	/** What `/api/paths` lists, for `@`. */
	tree: string[] = [];
	/** What every write answers with; a test sets it when the page reads it. */
	reply: unknown = {};
	/** Refuses every write with this, as the server does, when set. */
	refuseWrites: { reason: string; message: string } | null = null;
	/** Every write the page made, in order. */
	readonly posts: Post[] = [];
	/** The stream the page opened, so a test can push through it. */
	stream: Stream | null = null;
	/**
	 * The conversations `/api/conversations` lists, and the agents beside them;
	 * null, the default, answers as `arbor dev` without `--experimental` does.
	 */
	talk: {
		agents: { id: string; name: string }[];
		conversations: ConversationState[];
	} | null = null;
	/** The conversations' own stream, once the page opens it. */
	talkStream: Stream | null = null;
	/** What the page is told of the projects on this machine. */
	projects: ProjectChoice[] = [];
	/** The conversations `/api/release` says a restart would stop. */
	interrupted: Interrupted[] = [];
	#down = false;
	#refusal: { reason: string; message: string } | null = null;
	readonly #fetch = globalThis.fetch;
	readonly #eventSource = globalThis.EventSource;

	constructor() {
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			if (this.#down) {
				throw new Error("no server");
			}
			if (init?.method !== undefined && init.method !== "GET") {
				this.posts.push({ path, method: init.method, body: init.body });
				return this.refuseWrites === null
					? Response.json(this.reply)
					: Response.json(this.refuseWrites, { status: 409 });
			}
			// The project a page names is the page's business, not the fake's.
			const route = path.split("?")[0];
			if (route === "/api/projects") {
				return Response.json({ projects: this.projects });
			}
			if (route === "/api/release") {
				return Response.json({
					running: this.served.release?.running ?? "0.0.1",
					newest: this.served.release?.newest ?? null,
					interrupted: this.interrupted,
				});
			}
			if (path.startsWith("/api/paths")) {
				return Response.json(this.tree);
			}
			if (route === "/api/conversations") {
				return this.talk === null
					? Response.json({ reason: "not_found" }, { status: 404 })
					: Response.json(this.talk);
			}
			if (this.#refusal !== null) {
				return Response.json(this.#refusal, { status: 409 });
			}
			return Response.json(this.served);
		}) as unknown as typeof fetch;
		const testing = this;
		globalThis.EventSource = class implements Stream {
			onmessage: (() => void) | null = null;
			onopen: (() => void) | null = null;
			onerror: (() => void) | null = null;

			constructor(url: string) {
				if (url === "/api/conversations/events") {
					testing.talkStream = this;
				} else {
					testing.stream = this;
				}
			}

			// `EventSource`'s own name for it, which `Feed` calls; nothing is held.
			close(): void {}
		} as unknown as typeof EventSource;
	}

	/** Streams `state` to the page, as the server does when a conversation moves. */
	async say(state: ConversationState): Promise<void> {
		await act(async () =>
			this.talkStream?.onmessage?.({ data: JSON.stringify(state) }),
		);
	}

	/** Fails every fetch from now on, standing in for a server that went away. */
	goAway(): void {
		this.#down = true;
	}

	/** Refuses the snapshot from now on, as a server does with `reason`. */
	refuse(reason: string, message: string): void {
		this.#refusal = { reason, message };
	}

	/** Renders the page with `served` waiting, and lets it arrive. */
	async open(overrides: Partial<Snapshot> = {}) {
		this.served = snapshot(overrides);
		// The page a test before went to stays in the address: start on none, in
		// the project the test put there.
		history.replaceState(null, "", `${location.pathname}${location.search}`);
		const view = render(createElement(App));
		await waitFor(() =>
			expect(view.getByRole("region", { name: "Untriaged" })).toBeTruthy(),
		);
		return view;
	}

	/** Renders the page as `open` does, and goes to its tasks. */
	async openTasks(overrides: Partial<Snapshot> = {}) {
		const view = await this.open(overrides);
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Tasks/ })),
		);
		return view;
	}

	/** Hands `fetch` and `EventSource` back. */
	dispose(): void {
		localStorage.clear();
		globalThis.fetch = this.#fetch;
		globalThis.EventSource = this.#eventSource;
	}
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		repo: "webappwiz",
		path: "~/Projects/webappwiz",
		todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
		todos: [],
		lanes: [],
		tasks: [],
		release: null,
		...overrides,
	};
}

export function details(overrides: Partial<Details> = {}): Details {
	return {
		task: "alpha",
		status: "working",
		branch: "task/alpha",
		base: "main",
		worktree: "/tmp/repo-arbor/alpha",
		lease: "none",
		ahead: 1,
		added: 2,
		removed: 1,
		age: "3m",
		escalation: null,
		review: null,
		ready: true,
		plan: null,
		planProblems: [],
		...overrides,
	};
}

export function todo(overrides: Partial<TodoState> = {}): TodoState {
	return {
		id: 1,
		subject: "retry the upload",
		text: "",
		position: 1,
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		...overrides,
	};
}

export function conversation(
	overrides: Partial<ConversationState> = {},
): ConversationState {
	return {
		id: "c1",
		agent: "claude",
		task: null,
		title: null,
		status: "idle",
		error: null,
		name: null,
		archived: false,
		messages: [],
		ask: null,
		settings: [],
		createdAt: new Date().toISOString(),
		...overrides,
	};
}
