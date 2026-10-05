// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "../../../setup";
import { expect } from "bun:test";
import { createElement } from "react";
import type { Resource } from "webappwiz/disposable";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";

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
	onmessage: (() => void) | null;
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
	/** Every write the page made, in order. */
	readonly posts: Post[] = [];
	/** The stream the page opened, so a test can push through it. */
	stream: Stream | null = null;
	#down = false;
	readonly #fetch = globalThis.fetch;
	readonly #eventSource = globalThis.EventSource;

	constructor() {
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			if (this.#down) {
				throw new Error("no server");
			}
			if (init?.method !== undefined && init.method !== "GET") {
				this.posts.push({ path, method: init.method, body: init.body });
				return Response.json({});
			}
			if (path.startsWith("/api/paths")) {
				return Response.json(this.tree);
			}
			return Response.json(this.served);
		}) as unknown as typeof fetch;
		const testing = this;
		globalThis.EventSource = class implements Stream {
			onmessage: (() => void) | null = null;
			onopen: (() => void) | null = null;
			onerror: (() => void) | null = null;

			constructor() {
				testing.stream = this;
			}

			// `EventSource`'s own name for it, which `Feed` calls; nothing is held.
			close(): void {}
		} as unknown as typeof EventSource;
	}

	/** Fails every fetch from now on, standing in for a server that went away. */
	goAway(): void {
		this.#down = true;
	}

	/** Renders the page with `served` waiting, and lets it arrive. */
	async open(overrides: Partial<Snapshot> = {}) {
		this.served = snapshot(overrides);
		const view = render(createElement(App));
		await waitFor(() =>
			expect(view.getByRole("region", { name: "Todos" })).toBeTruthy(),
		);
		return view;
	}

	/** Hands `fetch` and `EventSource` back. */
	dispose(): void {
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
		tasks: [],
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
		tags: [],
		...overrides,
	};
}
