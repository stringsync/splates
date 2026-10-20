// Imported for the side effect, and first: the DOM it sets up must be in place
// before anything below loads react-dom.
import "./testing-dom";
import { expect } from "bun:test";
import type { AutoPickRulesView } from "@stringsync/splates-server/auto-pick";
import type {
	ConversationState,
	Session,
} from "@stringsync/splates-server/conversations";
import type { PortLink } from "@stringsync/splates-server/ports";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import type { ServerChoice } from "@stringsync/splates-server/server";
import type {
	MoveProgress,
	SetupProgress,
	UndoPlan,
} from "@stringsync/splates-server/setup";
import type { Landed } from "@stringsync/splates-server/stats/browser";
import type {
	FileDiff,
	FinishedPlan,
	Snapshot,
} from "@stringsync/splates-server/tasks";
import type { Held } from "@stringsync/splates-server/terminal";
import type {
	WorkerBudgetReport,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import { createElement } from "react";
import type { Resource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import type {
	Budgets,
	KeptCreds,
	MachineStatus,
	WorkerKeysListing,
} from "./api";
import type { AutoRestart } from "./auto-restart";
import type { AgentChoice } from "./conversation-feed";
import type { Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import { agentList, nameIn, openRow } from "./drivers";
import { EverywhereContext } from "./everywhere-context";
import { EverywhereFeed } from "./everywhere-feed";
import { FakeDraftFiles } from "./fake-draft-files";
import { FakePageCopies } from "./fake-page-copies";
import { FakeShell } from "./fake-shell";
import { details, snapshot } from "./fixtures";
import { NavigationContext, showAddress } from "./navigation";
import type { ProjectChoice } from "./project-api";
import { Settings } from "./settings";
import { act, fireEvent, ProjectApp, render, waitFor } from "./testing-dom";

export * from "./drivers";
export * from "./fixtures";

import { AGENTS, PUSH_KEY } from "./fixtures";

export {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-dom";

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

/**
 * How long the server stays unreachable before the page says it is offline:
 * long enough for a test to bring it back first, far shorter than the page's
 * ten seconds.
 */
export const OFFLINE_AFTER = Duration.ms(200);

/** A write the page made. */
export interface Post {
	path: string;
	method: string;
	body: BodyInit | null | undefined;
	headers?: HeadersInit;
}

/** The handlers `Feed` sets on its `EventSource`, for a test to call. */
export interface Stream {
	onmessage: ((event?: { data: string }) => void) | null;
	onopen: (() => void) | null;
	onerror: (() => void) | null;
	/** The listeners for named events, such as `removed`. */
	named?: Map<string, (event: { data: string }) => void>;
	/** Whether the page closed it. */
	closed?: boolean;
}

/**
 * The server the dev page runs against, faked in place of `fetch` and
 * `EventSource` from construction until `dispose`.
 *
 * The page never touches splates: it reads a `Snapshot` the server already
 * assembled and writes todos. So the fake is the snapshot and a record of the
 * posts, and none of these tests need a repo, a worktree or the CLI.
 * `dev.test.ts` covers the half that does.
 */
export class Testing implements Resource {
	/** What `/api/creds` says the stores keep. */
	kept: KeptCreds = {
		kept: [],
		labels: {
			project: 'the macOS Keychain as "webappwiz:webappwiz"',
			device: 'the macOS Keychain as "webappwiz"',
		},
	};
	/** What `/api/workers/keys` says workers hold. */
	workerKeys: WorkerKeysListing = {
		keys: [],
		providers: [],
		holders: { workers: [], types: [] },
	};
	/** What `/api/budgets` says of the project's scry budgets. */
	budgets: Budgets = { declared: false, roles: [] };
	/** What the page reads; a test sets it before the page fetches again. */
	served: Snapshot = snapshot();
	/** What `/api/paths` lists, for `@`. */
	tree: string[] = [];
	/** What `/api/paths` waits on, for a test to hold them back. */
	listing: Promise<void> = Promise.resolve();
	/**
	 * What `/api/projects` waits on, for a test to hold one listing back, which
	 * answers with the projects as they stood when asked.
	 */
	listingProjects: Promise<void> = Promise.resolve();
	/** Each task's diff, by task, for `/api/tasks/:task/diff`. */
	diffs: Record<string, FileDiff[]> = {};
	/** The finished tasks `/api/finished` lists, newest first, each with its plan. */
	finished: FinishedPlan[] = [];
	/** How each merged task went, by task, for `/api/tasks/:task/outcome`; null for one absent. */
	landed: Record<string, Landed> = {};
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
	/** The `splates server`s on this machine the page is told of. */
	servers: ServerChoice[] = [];
	/** The restart `/api/projects` says follows the checkpoint, if any. */
	restarting: { resume: boolean; shutdown: boolean } | null = null;
	/** How `/api/projects` says this run began, after a checkpoint's restart. */
	restarted: "resuming" | null = null;
	/** The run of `splates server` `/api/projects` names: a test changes it to restart. */
	run = "run-1";
	/** Whether `/api/projects` says `splates server` can restart itself. */
	restartable = true;
	/** Every path the page fetched, in order. */
	asked: string[] = [];
	/** Every address the page asked to go to or show, in order. */
	visited: string[] = [];
	/** How many times the page asked to reload. */
	reloads = 0;
	/** What restarts the page on its own; one on the system clock unless set. */
	autoRestart: AutoRestart | undefined = undefined;
	/** What threads wait by, so a test decides when a moment has passed. */
	readonly timer = new FakeTimer();
	/** The date threads read, frozen where the test began. */
	readonly wall = new FakeWallClock(Date.now());
	/** What the composers' mic records with; none unless a test gives one. */
	dictation: Dictation | null = null;
	/** Where drafts' files are kept across the page's reloads in a test. */
	readonly draftFiles = new FakeDraftFiles();
	/** Where the page keeps what the server last said across reloads. */
	readonly copies = new FakePageCopies();
	/** What `/api/projects` says a restart would kill. */
	held: Held[] = [];
	/** Who `/api/identity` says Cloudflare Access signed in, or null. */
	email: string | null = null;
	/** The public key `/api/push` hands out, which a device subscribes with. */
	pushKey = PUSH_KEY;
	/** What `/api/machine` reads, or null for it to fail. */
	machine: MachineStatus | null = null;
	/** What `/api/worker-budget` reads, or null for no budget, as without a `workerProvider`. */
	workerBudget: WorkerBudgetReport | null = null;
	/** What `/api/workers` lists, or null for it to fail. */
	workers: WorkerPool | null = null;
	/** What `/api/setup` reads, or null for it to fail. */
	setup: SetupProgress | null = null;
	/** What `GET /api/setup/:area/undo` reads, or null for it to fail. */
	undoPlan: UndoPlan | null = null;
	/** What `/api/auto-pick/rules` reads, or null for it to fail. */
	autoPickRules: AutoPickRulesView | null = null;
	/** What `/api/setup/coordinator/move` reads, or null for it to fail. */
	coordinatorMove: MoveProgress | null = null;
	/** The ports `/api/ports` says tasks serve. */
	ports: PortLink[] = [];
	/**
	 * Every project `/api/everywhere` lists, or null for it to refuse, as
	 * through a tunnel with no Access.
	 */
	everywhere: EverywhereProject[] | null = null;
	/** The page's stream of every project, once it opened one. */
	everywhereStream: Stream | null = null;
	/** Every terminal the page opened, oldest first. */
	readonly shells: FakeShell[] = [];
	#down: boolean | number = false;
	#held: Promise<void> | null = null;
	#heldWrites: Promise<void> | null = null;
	#answerWrites = () => {};
	#refusal: { reason: string; message: string } | null = null;
	readonly #fetch = globalThis.fetch;
	readonly #eventSource = globalThis.EventSource;
	readonly #webSocket = globalThis.WebSocket;

	constructor() {
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			this.asked.push(path);
			if (this.#held !== null && path.startsWith("/api/snapshot")) {
				await this.#held;
			}
			if (typeof this.#down === "number") {
				return new Response(null, { status: this.#down });
			}
			if (this.#down) {
				// As `fetch` does when nothing listens.
				throw new TypeError("no server");
			}
			if (init?.method !== undefined && init.method !== "GET") {
				this.posts.push({
					path,
					method: init.method,
					body: init.body,
					headers: init.headers,
				});
				await this.#heldWrites;
				return this.refuseWrites === null
					? Response.json(this.reply)
					: Response.json(this.refuseWrites, { status: 409 });
			}
			// The project a page names is the page's business, not the fake's.
			const route = path.split("?")[0];
			if (route === "/api/projects") {
				const listed = {
					projects: this.projects,
					servers: this.servers,
					restarting: this.restarting,
					restarted: this.restarted,
					run: this.run,
					running: this.served.release?.running ?? "0.0.1",
					newest: this.served.release?.newest ?? null,
					behind: this.served.behind,
					restartable: this.restartable,
					held: this.held,
				};
				await this.listingProjects;
				return Response.json(listed);
			}
			if (route === "/api/everywhere") {
				return this.everywhere === null
					? new Response(null, { status: 403 })
					: Response.json({ projects: this.everywhere });
			}
			if (route === "/api/creds") {
				return Response.json(this.kept);
			}
			if (route === "/api/workers/keys") {
				return Response.json(this.workerKeys);
			}
			if (route === "/api/budgets") {
				return Response.json(this.budgets);
			}
			if (route === "/api/identity") {
				return Response.json({ email: this.email });
			}
			if (route === "/api/push") {
				return Response.json({ publicKey: this.pushKey });
			}
			if (route === "/api/setup") {
				return this.setup === null
					? new Response(null, { status: 500 })
					: Response.json(this.setup);
			}
			if (route?.startsWith("/api/setup/") && route.endsWith("/undo")) {
				return this.undoPlan === null
					? new Response(null, { status: 500 })
					: Response.json(this.undoPlan);
			}
			if (route === "/api/auto-pick/rules") {
				return this.autoPickRules === null
					? new Response(null, { status: 500 })
					: Response.json(this.autoPickRules);
			}
			if (route === "/api/setup/coordinator/move") {
				return this.coordinatorMove === null
					? new Response(null, { status: 502 })
					: Response.json(this.coordinatorMove);
			}
			if (route === "/api/ports") {
				return Response.json({ base: null, ports: this.ports });
			}
			if (route === "/api/workers") {
				return this.workers === null
					? new Response(null, { status: 500 })
					: Response.json(this.workers);
			}
			if (route === "/api/worker-budget") {
				return this.workerBudget === null
					? Response.json(
							{ reason: "usage", message: "no worker budget" },
							{ status: 400 },
						)
					: Response.json(this.workerBudget);
			}
			if (route === "/api/machine") {
				return this.machine === null
					? new Response(null, { status: 500 })
					: Response.json(this.machine);
			}
			if (path.startsWith("/api/paths")) {
				await this.listing;
				return Response.json(this.tree);
			}

			if (route === "/api/finished") {
				return Response.json(
					this.finished.map(({ plan: _, ...facts }) => facts),
				);
			}
			const finished = /^\/api\/finished\/([^/]+)$/.exec(route ?? "");
			if (finished !== null) {
				const key = decodeURIComponent(finished[1] ?? "");
				const found = this.finished.find((each) => each.key === key);
				return found === undefined
					? Response.json({ reason: "not_found" }, { status: 404 })
					: Response.json(found);
			}
			const diff = /^\/api\/tasks\/([^/]+)\/diff$/.exec(route ?? "");
			if (diff !== null) {
				return Response.json(
					this.diffs[decodeURIComponent(diff[1] ?? "")] ?? [],
				);
			}
			const outcome = /^\/api\/tasks\/([^/]+)\/outcome$/.exec(route ?? "");
			if (outcome !== null) {
				return Response.json(
					this.landed[decodeURIComponent(outcome[1] ?? "")] ?? null,
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
			closed = false;

			constructor(url: string) {
				const route = url.split("?")[0];
				if (route === "/api/conversations/events") {
					testing.talkStream = this;
				} else if (route === "/api/everywhere/events") {
					testing.everywhereStream = this;
					// Open at once, as the server's is, so the feed lists.
					queueMicrotask(() => this.onopen?.());
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

			// `EventSource`'s own name for it, which `Feed` calls.
			close(): void {
				this.closed = true;
			}
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

	/** Keeps every snapshot from arriving until `release`. */
	holdSnapshots(): () => void {
		let arrive = () => {};
		this.#held = new Promise<void>((resolve) => {
			arrive = resolve;
		});
		return arrive;
	}

	/** Keeps every write unanswered (though posted) until `release`. */
	holdWrites(): void {
		this.#heldWrites = new Promise<void>((resolve) => {
			this.#answerWrites = resolve;
		});
	}

	/** Answers the writes `holdWrites` kept. */
	release(): void {
		this.#answerWrites();
	}

	/** Fails every fetch from now on, standing in for a server that went away. */
	goAway(status?: number): void {
		this.#down = status ?? true;
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
		const view = this.render(overrides);
		// Hidden too, under a dialog the page opens on.
		await waitFor(() =>
			expect(
				view.queryByRole("region", { name: "inbox", hidden: true }) ??
					view.getByRole("region", { name: "Untriaged", hidden: true }),
			).toBeTruthy(),
		);
		return view;
	}

	/** Renders the page with `served` waiting, without waiting for it. */
	render(overrides: Partial<Snapshot> = {}) {
		this.served = snapshot(overrides);
		// The page a test before went to stays in the address: start on none, in
		// the project the test put there.
		history.replaceState(null, "", `${location.pathname}${location.search}`);
		const view = render(
			createElement(
				NavigationContext,
				{
					value: {
						go: (url: string) => this.visited.push(url),
						// Another project's page draws in this one, as it does
						// in a browser, so a test sees the switch through.
						show: (url: string) => {
							this.visited.push(url);
							showAddress(url);
						},
					},
				},
				createElement(
					DictationContext,
					{ value: this.dictation },
					createElement(
						EverywhereContext,
						{ value: new EverywhereFeed() },
						createElement(ProjectApp, {
							settings: new Settings(localStorage),
							checkpointEvery: CHECKPOINT_EVERY,
							checkpointRestartShown: CHECKPOINT_RESTART_SHOWN,
							offlineAfter: OFFLINE_AFTER,
							reload: () => {
								this.reloads++;
							},
							autoRestart: this.autoRestart,
							timer: this.timer,
							wall: this.wall,
							draftFiles: this.draftFiles,
							copies: this.copies,
						}),
					),
				),
			),
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

	/** Opens the page with conversations on, holding `held`. */
	async openConversations(
		held: ConversationState[],
		open: string | null = held[0]?.id ?? null,
		overrides: Partial<Snapshot> = {},
		agents: AgentChoice[] = AGENTS,
	) {
		this.talk = { agents, conversations: held };
		// Held by an agent outside the page, so it is not orphaned.
		const view = await this.open({
			tasks: [details({ task: "alpha", lease: "held" })],
			...overrides,
		});
		// A phone opens on its inbox; beside a sidebar, go to Conversations.
		const list = await waitFor(() => agentList(view));
		if (open !== null) {
			await openRow(view, nameIn(held, open));
		} else if (list.tagName === "NAV") {
			await act(async () => {
				location.hash = "#conversations";
				window.dispatchEvent(new HashChangeEvent("hashchange"));
			});
		}
		return view;
	}

	/**
	 * What the page posted to `path`, each body parsed: a form as its fields,
	 * the files it carries as `file`, leaving out the id the page names a
	 * message on its way by (see `sentId`).
	 */
	posted(path: string) {
		return this.posts
			.filter((post) => post.path === path)
			.map((post) => ({
				method: post.method,
				body:
					post.body instanceof FormData
						? fields(post.body)
						: JSON.parse(String(post.body ?? "{}")),
			}));
	}

	/**
	 * The id the page gave the message it last posted to conversation
	 * `conversation` with `text`, for the server's copy to come back with.
	 */
	sentId(conversation: string, text: string): string {
		const sent = this.posts.findLast(
			(post) =>
				post.path === `/api/conversations/${conversation}/prompt` &&
				post.body instanceof FormData &&
				post.body.get("text") === text,
		)?.body as FormData | undefined;
		const id = sent?.get("id");
		if (typeof id !== "string") {
			throw new Error(`no message ${text} posted to ${conversation}`);
		}
		return id;
	}

	/** Hands `fetch`, `EventSource` and `WebSocket` back. */
	dispose(): void {
		localStorage.clear();
		sessionStorage.clear();
		globalThis.fetch = this.#fetch;
		globalThis.EventSource = this.#eventSource;
		globalThis.WebSocket = this.#webSocket;
	}
}

/** The page as `openConversations` rendered it. */
export type ConversationsView = Awaited<
	ReturnType<Testing["openConversations"]>
>;

/** `form`'s fields, each by its name, and the files it carries as `file`. */
function fields(form: FormData): Record<string, unknown> {
	const files = form.getAll("file");
	return {
		...Object.fromEntries(
			[...form.entries()].filter(([name]) => name !== "file" && name !== "id"),
		),
		...(files.length === 0 ? {} : { file: files }),
	};
}
