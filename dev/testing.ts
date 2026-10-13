// Imported for the side effect, and before anything that touches a global:
// it is what puts a DOM on `globalThis` for React to render into.
import "../../../setup";
import { expect } from "bun:test";
import { createElement } from "react";
import type { Resource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import type {
	Checkpoint,
	ConversationState,
	Message,
	Part,
	Session,
	Tool,
} from "../conversations";
import type { FileDiff } from "../diff";
import type { Details } from "../show";
import type { Snapshot } from "../snapshot";
import type { NamedSystem } from "../systems";
import type { TodoState } from "../todo";
import type { ProjectChoice } from "./api";
import type { AgentChoice } from "./conversation-feed";
import { FakeShell } from "./fake-shell";
import { Settings } from "./settings";

// Loaded only once the DOM above is in place, and handed on from here so a test
// file need not load them itself. Bun loads a package's CommonJS while it links
// the static imports, before even this file's own `setup` import has run, and
// react-dom decides at load time whether the browser has `input` events:
// loaded too early, it concludes it does not, and no `onChange` ever fires.
export const { act, cleanup, fireEvent, render, waitFor, within } =
	await import("@testing-library/react");
const { App } = await import("./app");
const {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isElementNode,
	getNearestEditorFromDOMNode,
} = await import("lexical");

/**
 * How often the page asks after a checkpoint under way: a tick a test waits
 * through, so far shorter than the page's second.
 */
const CHECKPOINT_EVERY = Duration.ms(50);

/**
 * How long a checkpoint's Restart slide shows at least: long enough for a
 * test to see it, far shorter than the page's three seconds.
 */
const CHECKPOINT_RESTART_SHOWN = Duration.ms(300);

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
	/** The listeners for named events, such as `removed`. */
	named?: Map<string, (event: { data: string }) => void>;
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
	/** What `/api/systems` lists, for `#`. */
	systems: NamedSystem[] = [];
	/** What `/api/paths` and `/api/systems` wait on, for a test to hold them back. */
	listing: Promise<void> = Promise.resolve();
	/** Each task's diff, by task, for `/api/tasks/:task/diff`. */
	diffs: Record<string, FileDiff[]> = {};
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
	 * null, the default, answers as a server with no conversations does.
	 */
	talk: {
		agents: AgentChoice[];
		conversations: ConversationState[];
	} | null = null;
	/** The sessions `/api/conversations/sessions` lists for any task. */
	sessions: Session[] = [];
	/** What each background command printed, by its id, as the server reads it. */
	outputs: Record<string, string> = {};
	/** The conversations' own stream, once the page opens it. */
	talkStream: Stream | null = null;
	/** What the page is told of the projects on this machine. */
	projects: ProjectChoice[] = [];
	/** The restart `/api/projects` says follows the checkpoint, if any. */
	restarting: { resume: boolean } | null = null;
	/** How `/api/projects` says this run began, after a checkpoint's restart. */
	restarted: "waiting" | "resuming" | null = null;
	/** The run of `arbor dev` `/api/projects` names: a test changes it to restart. */
	run = "run-1";
	/** Whether `/api/projects` says `arbor dev` can restart itself. */
	restartable = true;
	/** Every terminal the page opened, oldest first. */
	readonly shells: FakeShell[] = [];
	#down = false;
	#refusal: { reason: string; message: string } | null = null;
	readonly #fetch = globalThis.fetch;
	readonly #eventSource = globalThis.EventSource;
	readonly #webSocket = globalThis.WebSocket;

	constructor() {
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			if (this.#down) {
				// As `fetch` does when nothing listens.
				throw new TypeError("no server");
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
				return Response.json({
					projects: this.projects,
					restarting: this.restarting,
					restarted: this.restarted,
					run: this.run,
					running: this.served.release?.running ?? "0.0.1",
					newest: this.served.release?.newest ?? null,
					behind: this.served.behind,
					restartable: this.restartable,
				});
			}
			if (path.startsWith("/api/paths")) {
				await this.listing;
				return Response.json(this.tree);
			}
			if (path.startsWith("/api/systems")) {
				await this.listing;
				return Response.json(this.systems);
			}
			const diff = /^\/api\/tasks\/([^/]+)\/diff$/.exec(route ?? "");
			if (diff !== null) {
				return Response.json(
					this.diffs[decodeURIComponent(diff[1] ?? "")] ?? [],
				);
			}
			if (route === "/api/conversations/sessions") {
				return Response.json(this.sessions);
			}
			const output = /^\/api\/conversations\/[^/]+\/background\/([^/]+)$/.exec(
				route ?? "",
			);
			if (output !== null) {
				return new Response(
					this.outputs[decodeURIComponent(output[1] ?? "")] ?? "",
				);
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
			readonly named = new Map<string, (event: { data: string }) => void>();

			constructor(url: string) {
				if (url === "/api/conversations/events") {
					testing.talkStream = this;
				} else {
					testing.stream = this;
				}
			}

			addEventListener(
				name: string,
				listener: (event: { data: string }) => void,
			): void {
				this.named.set(name, listener);
			}

			// `EventSource`'s own name for it, which `Feed` calls; nothing is held.
			close(): void {}
		} as unknown as typeof EventSource;
		globalThis.WebSocket = class extends FakeShell {
			constructor(url: string) {
				super(url);
				testing.shells.push(this);
			}
		} as unknown as typeof WebSocket;
	}

	/** Streams `state` to the page, as the server does when a conversation moves. */
	async say(state: ConversationState): Promise<void> {
		await act(async () =>
			this.talkStream?.onmessage?.({ data: JSON.stringify(state) }),
		);
	}

	/** Streams the deletion of conversation `id`, as the server does for an older archived one. */
	async remove(id: string): Promise<void> {
		await act(async () =>
			this.talkStream?.named?.get("removed")?.({ data: id }),
		);
	}

	/** Fails every fetch from now on, standing in for a server that went away. */
	goAway(): void {
		this.#down = true;
	}

	/** Answers again, as a server back from a restart. */
	comeBack(): void {
		this.#down = false;
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
		const view = render(
			createElement(App, {
				settings: new Settings(localStorage),
				checkpointEvery: CHECKPOINT_EVERY,
				checkpointRestartShown: CHECKPOINT_RESTART_SHOWN,
			}),
		);
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

	/** Opens the page with conversations on, holding `held`, on their tab. */
	async openConversations(
		held: ConversationState[],
		open: string | null = held[0]?.id ?? null,
		overrides: Partial<Snapshot> = {},
		agents: AgentChoice[] = AGENTS,
	) {
		this.talk = { agents, conversations: held };
		const view = await this.open({
			tasks: [details({ task: "alpha" })],
			...overrides,
		});
		const tab = await waitFor(() =>
			view.getByRole("tab", { name: /Conversations/ }),
		);
		await act(async () => fireEvent.click(tab));
		if (open !== null) {
			const nav = view.getByRole("navigation", { name: "conversations" });
			const item = within(nav)
				.getAllByRole("listitem")
				.flatMap((row) => within(row).getAllByRole("button"))
				.find((button) => button.textContent?.includes(nameIn(held, open)));
			if (item === undefined) {
				throw new Error(`no conversation ${open} listed`);
			}
			await act(async () => fireEvent.click(item));
		}
		return view;
	}

	/** What the page posted to `path`, each body parsed. */
	posted(path: string) {
		return this.posts
			.filter((post) => post.path === path)
			.map((post) => ({
				method: post.method,
				body: JSON.parse(String(post.body ?? "{}")),
			}));
	}

	/** Hands `fetch`, `EventSource` and `WebSocket` back. */
	dispose(): void {
		localStorage.clear();
		globalThis.fetch = this.#fetch;
		globalThis.EventSource = this.#eventSource;
		globalThis.WebSocket = this.#webSocket;
	}
}

export const AGENTS: AgentChoice[] = [
	{ id: "claude", name: "Claude", settings: [] },
	{ id: "codex", name: "Codex", settings: [] },
];

/** The name the sidebar lists conversation `id` of `held` under. */
function nameIn(held: ConversationState[], id: string): string {
	const found = held.find((each) => each.id === id);
	const opening = found?.messages
		.filter((message) => message.role === "user")
		.flatMap((message) => message.parts)
		.flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
		.find((text) => text !== "")
		?.split("\n")[0];
	return found?.name ?? found?.task ?? found?.title ?? opening ?? "Not started";
}

/** The page as `openConversations` rendered it. */
export type ConversationsView = Awaited<
	ReturnType<Testing["openConversations"]>
>;

/** Opens the new conversation screen with `agent`, from the sidebar. */
export async function newWith(
	view: ConversationsView,
	agent: string,
): Promise<void> {
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "New" })),
	);
	await act(async () =>
		fireEvent.click(
			await waitFor(() =>
				view.getByRole("menuitem", { name: new RegExp(agent) }),
			),
		),
	);
}

/**
 * Types `text` into the composer `box` in place of what it holds, the caret
 * at its end, as its editor takes typing.
 */
export function typeIn(box: HTMLElement, text: string): Promise<void> {
	return act(async () => {
		box.focus();
		editorOf(box).update(
			() => {
				const root = $getRoot().clear();
				for (const line of text.split("\n")) {
					root.append(
						$createParagraphNode().append(
							...(line === "" ? [] : [$createTextNode(line)]),
						),
					);
				}
				root.selectEnd();
			},
			{ discrete: true },
		);
	});
}

/** What the composer `box` holds, as its text: a chip as what it reads. */
export function textIn(box: HTMLElement): string {
	return editorOf(box)
		.getEditorState()
		.read(() =>
			$getRoot()
				.getChildren()
				.map((line) =>
					$isElementNode(line)
						? line
								.getChildren()
								.map((child) => child.getTextContent())
								.join("")
						: "",
				)
				.join("\n"),
		);
}

function editorOf(box: HTMLElement) {
	const editor = getNearestEditorFromDOMNode(box);
	if (editor === null) {
		throw new Error("not a composer");
	}
	return editor;
}

/** Picks an option of a Select: Base UI picks on the pointer let go. */
export function pick(option: HTMLElement): Promise<void> {
	return act(async () => {
		fireEvent.pointerDown(option, { pointerType: "mouse" });
		fireEvent.mouseDown(option);
		fireEvent.pointerUp(option, { pointerType: "mouse" });
		fireEvent.mouseUp(option);
		fireEvent.click(option);
	});
}

/** Presses ⌥⌘⌫, by the key's place as on a Mac. */
export function pressArchive(): Promise<void> {
	return act(async () => {
		fireEvent.keyDown(document.body, {
			code: "Backspace",
			altKey: true,
			metaKey: true,
		});
	});
}

/**
 * Opens the menu beside the project's name, unless open already, and waits
 * for its item named `name`, for a test to click or read.
 */
export async function menuItem(
	view: ConversationsView,
	name: string | RegExp,
): Promise<HTMLElement> {
	if (view.queryByRole("menu") === null) {
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: /^More(: restart to update)?$/ }),
			),
		);
	}
	return await waitFor(() => view.getByRole("menuitem", { name }));
}

/** Sizes the window, as a phone held upright or a laptop. */
export function resize(width: number, height: number): void {
	(
		window as unknown as {
			happyDOM: { setViewport(size: { width: number; height: number }): void };
		}
	).happyDOM.setViewport({ width, height });
}

/** A conversation of a project's, as the projects route lists it. */
export function live(
	id: string,
	name: string,
	checkpoint: Checkpoint | null = null,
) {
	return {
		id,
		name,
		status: checkpoint === "done" ? "stopped" : "running",
		checkpoint,
	};
}

/** A project as the projects route lists it, holding `listed`. */
export function project(
	slug: string,
	listed: ProjectChoice["conversations"],
	here = false,
): ProjectChoice {
	return {
		slug,
		root: `/code/${slug}`,
		gone: false,
		here,
		conversations: listed,
		waiting: 0,
	};
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
	return {
		repo: "webappwiz",
		path: "~/Projects/webappwiz",
		root: "/repo",
		worktreeRoot: "/repo-arbor",
		todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
		todos: [],
		lanes: [],
		tasks: [],
		trunk: "main",
		release: null,
		behind: null,
		unbuilt: false,
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
		createdAt: "2026-10-11T09:57:00.000Z",
		escalation: null,
		mergeAttempts: 0,
		mergeAttemptLimit: 3,
		escalatedAt: null,
		review: null,
		ready: true,
		plan: null,
		planProblems: [],
		dispatched: false,
		systems: [],
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
		unread: false,
		seen: 0,
		messages: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt: new Date().toISOString(),
		checkpoint: null,
		usage: { context: null, input: 0, cached: 0, output: 0, cost: null },
		lastTask: overrides.task ?? null,
		lastBase: null,
		background: [],
		...overrides,
	};
}

/** A message of `role` made of `parts`, a string standing for its text. */
export function message(
	role: Message["role"],
	...parts: (Part | string)[]
): Message {
	return {
		role,
		parts: parts.map((part) =>
			typeof part === "string" ? { type: "text", text: part } : part,
		),
		plan: null,
		at: null,
		until: null,
	};
}

export function tool(overrides: Partial<Tool> = {}): Tool {
	return {
		type: "tool",
		id: "t1",
		title: "cat note.txt",
		status: "completed",
		kind: "execute",
		command: null,
		target: null,
		output: "",
		edits: [],
		paths: [],
		parent: null,
		at: null,
		until: null,
		flags: [],
		decision: null,
		...overrides,
	};
}
