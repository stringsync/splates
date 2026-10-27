// scry-ignore-file compact-files: the page tests' one fake server; its routes belong together
import type {
	BillingView,
	SpendReport,
} from "@stringsync/splates-server/spend";
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
import type { SetupProgress, UndoPlan } from "@stringsync/splates-server/setup";
import type {
	Landed,
	RuleOverrides,
} from "@stringsync/splates-server/stats/browser";
import type {
	FileDiff,
	FinishedPlan,
	Snapshot,
} from "@stringsync/splates-server/tasks";
import type { Held } from "@stringsync/splates-server/terminal";
import type { WorkerPool } from "@stringsync/splates-server/workers";
import { createElement } from "react";
import { aborts } from "webappwiz/abort";
import type { Resource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import type { Budgets, KeptCreds, MachineStatus } from "./api";
import { WAITS } from "./api";
import type { AutoRestart } from "./auto-restart";
import type { AgentChoice } from "./conversation-feed";
import type { Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import { agentList, nameIn, openRow } from "./drivers";
import { EverywhereContext } from "./everywhere-context";
import { EverywhereFeed } from "./everywhere-feed";
import { RepliedIds } from "./fake-conversation-ids";
import { FakeDraftFiles } from "./fake-draft-files";
import { FakePageCopies } from "./fake-page-copies";
import { FakeShell } from "./fake-shell";
import { FakeStream, type Stream } from "./fake-stream";
import { details, snapshot } from "./fixtures";
import { NavigationContext, showAddress } from "./navigation";
import { PageCopy } from "./page-copy";
import type { ProjectChoice } from "./project-api";
import { Settings } from "./settings";
import {
	act,
	fireEvent,
	ProjectApp,
	render,
	waitFor,
	within,
} from "./testing-dom";

export * from "./drivers";
export type { Stream } from "./fake-stream";
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
 * How long a test's server stays unreachable before the page says it is
 * offline; a test that brings the server back sooner never sees Offline.
 */
export const OFFLINE_AFTER = Duration.ms(200);

/** A write the page made. */
export interface Post {
	path: string;
	method: string;
	body: BodyInit | null | undefined;
	headers?: HeadersInit;
}

/**
 * A fake server for a page test: construct one, set what it serves (`served`,
 * `spendReport` and the rest), `open()` the page, read `posts` for what the
 * page wrote, and `dispose` it after. It stands in for `fetch` and
 * `EventSource` until then.
 */
export class Testing implements Resource {
	// The page never touches splates: it reads a `Snapshot` the server already
	// assembled and writes todos. So the fake is the snapshot and a record of
	// the posts, and none of these tests need a repo, a worktree or the CLI.
	// `dev.test.ts` covers the half that does.

	/** What `/api/creds` says the stores keep. */
	kept: KeptCreds = {
		kept: [],
		providers: ["system"],
		labels: {
			system: {
				project: 'the macOS Keychain as "webappwiz:webappwiz"',
				device: 'the macOS Keychain as "webappwiz"',
			},
		},
	};
	/** What `/api/budgets` says of the project's scry budgets. */
	budgets: Budgets = { declared: false, roles: [] };
	/** What `/api/billing` says of the currency and each provider's pull. */
	billingView: BillingView = {
		currency: "USD",
		currencies: ["USD", "EUR"],
		pulledAt: null,
		providers: [],
	};
	/** What `/api/spend` says of the dollars spent. */
	spendReport: SpendReport = {
		updated: "2026-10-21T12:00:00.000Z",
		currency: "USD",
		rateDate: null,
		rateError: null,
		services: [],
		days: [],
		projects: [],
		upcoming: [],
	};
	/** What `/api/budgets` waits on, for a test to hold a reading back. */
	readingBudgets: Promise<void> = Promise.resolve();
	/** What the page reads; a test sets it before the page fetches again. */
	served: Snapshot = snapshot();
	/** What the page reads of another project's, by the slug `?project=` names. */
	servedOf: Record<string, Snapshot> = {};
	/** What `/api/ship/plan` draws for a ship approval. */
	shipPlan = {
		from: "webappwiz",
		steps: [
			{
				slug: "webappwiz",
				action: "ship",
				from: "0.0.50",
				bump: "patch",
				to: "0.0.51",
				publishes: ["webappwiz"],
				takes: [],
				why: "the project shipped",
			},
		],
	};
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
	/** What `/api/conversations/<id>` reads whole, for a listed summary, by id. */
	wholes: Record<string, ConversationState | number> = {};
	private readonly histories = new Map<string, Promise<void>>();
	/** The sessions `/api/conversations/sessions` lists for any task. */
	sessions: Session[] = [];
	/** What `/api/migration` says of a project whose records failed to migrate. */
	migration: unknown = { failure: null, fix: null, trunk: "main" };
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
	/** What `/api/workers` lists, or null for it to fail. */
	workers: WorkerPool | null = null;
	/** What `/api/setup` reads, or null for it to fail. */
	setup: SetupProgress | null = null;
	/** What `GET /api/setup/:area/undo` reads, or null for it to fail. */
	undoPlan: UndoPlan | null = null;
	/** What `/api/auto-pick/rules` reads, or null for it to fail. */
	autoPickRules: AutoPickRulesView | null = null;
	/** What `/api/auto-pick/overrides` reads. */
	autoPickOverrides: RuleOverrides[] = [];
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
	#hung: string[] = [];
	readonly #answer = WAITS.answer;
	readonly #fetch = globalThis.fetch;
	readonly #eventSource = globalThis.EventSource;
	readonly #webSocket = globalThis.WebSocket;

	constructor() {
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			this.asked.push(path);
			// A real fetch rejects once its signal aborts, as the page's timeouts do.
			const waiting = (until: Promise<void>) =>
				init?.signal ? aborts.race(init.signal, until) : until;
			if (this.#hung.some((route) => path.startsWith(route))) {
				await waiting(new Promise<void>(() => {}));
			}
			if (this.#held !== null && path.startsWith("/api/snapshot")) {
				await waiting(this.#held);
			}
			if (typeof this.#down === "number") {
				return new Response(null, { status: this.#down });
			}
			if (this.#down) {
				// As `fetch` does when nothing listens.
				throw new TypeError("no server");
			}
			if (path === "/api/billing/pull") {
				return Response.json(this.billingView);
			}
			if (init?.method !== undefined && init.method !== "GET") {
				this.posts.push({
					path,
					method: init.method,
					body: init.body,
					headers: init.headers,
				});
				await waiting(this.#heldWrites ?? Promise.resolve());
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
			if (route === "/api/billing") {
				return Response.json(this.billingView);
			}
			if (route === "/api/spend") {
				return Response.json(this.spendReport);
			}
			if (route === "/api/budgets") {
				await this.readingBudgets;
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
			if (route === "/api/auto-pick/overrides") {
				return Response.json(this.autoPickOverrides);
			}
			if (route === "/api/auto-pick/rules") {
				return this.autoPickRules === null
					? new Response(null, { status: 500 })
					: Response.json(this.autoPickRules);
			}
			if (route === "/api/ports") {
				return Response.json({ base: null, ports: this.ports });
			}
			if (route === "/api/workers") {
				return this.workers === null
					? new Response(null, { status: 500 })
					: Response.json(this.workers);
			}
			if (route === "/api/ship/plan") {
				return Response.json(this.shipPlan);
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

			// No recent merges, so a merge card shows only its own times.
			if (route === "/api/merge-estimates") {
				return Response.json({ steps: {}, phases: [], merges: 0 });
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
			if (route === "/api/migration") {
				return Response.json(this.migration);
			}
			const whole = /^\/api\/conversations\/([^/]+)$/.exec(route ?? "");
			const read = this.wholes[decodeURIComponent(whole?.[1] ?? "")];
			if (read !== undefined) {
				await waiting(
					this.histories.get(decodeURIComponent(whole?.[1] ?? "")) ??
						Promise.resolve(),
				);
				if (typeof read === "number") {
					return new Response(null, { status: read });
				}
				return Response.json(read);
			}
			if (route === "/api/conversations") {
				return this.talk === null
					? Response.json({ reason: "not_found" }, { status: 404 })
					: Response.json(this.talk);
			}
			if (this.#refusal !== null) {
				return Response.json(this.#refusal, { status: 409 });
			}
			const of =
				this.servedOf[
					new URL(path, "http://page").searchParams.get("project") ?? ""
				];
			if (route === "/api/snapshot" && of !== undefined) {
				return Response.json(of);
			}
			return Response.json(this.served);
		}) as unknown as typeof fetch;
		const testing = this;
		globalThis.EventSource = class extends FakeStream {
			constructor(url: string) {
				super();
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

	/** Keeps this conversation's full history from arriving until released. */
	holdHistory(id: string): () => void {
		let release = () => {};
		this.histories.set(
			id,
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		return release;
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

	/**
	 * Leaves every request whose path starts with `route` unanswered for good,
	 * as a server stuck on it, so the page's own timeout ends the wait.
	 */
	hang(route: string): void {
		this.#hung.push(route);
	}

	/** Answers what `hang` left unanswered from now on. */
	unhang(): void {
		this.#hung = [];
	}

	/**
	 * Gives the page `within` for each request instead of its thirty seconds,
	 * so a test of a timeout runs in a moment.
	 */
	answerWithin(within: Duration): void {
		WAITS.answer = within;
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

	/** Serves the snapshot again, as a server whose refusal was put right. */
	stopRefusing(): void {
		this.#refusal = null;
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
						{
							value: new EverywhereFeed({
								copy: new PageCopy(this.copies, "everywhere", this.timer),
							}),
						},
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
							conversationIds: new RepliedIds(this),
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
			fireEvent.click(view.getByRole("tab", { name: /Queue/ })),
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
		WAITS.answer = this.#answer;
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

/**
 * The Queue page's row named `name` in its list `list`, as Started by you's
 * "task list" or Up next's "queued tasks".
 */
export function queueRow(
	view: Pick<ReturnType<typeof within>, "getByRole">,
	name: string,
	list = "task list",
): HTMLElement {
	const row = within(view.getByRole("list", { name: list }))
		.getByText(name)
		.closest("li");
	if (row === null) {
		throw new Error(`no row ${name} in ${list}`);
	}
	return row;
}

/** Opens the Queue page's row named `name` in its list `list`, by its Open. */
export async function openQueueRow(
	view: Pick<ReturnType<typeof within>, "getByRole">,
	name: string,
	list = "task list",
): Promise<void> {
	await act(async () =>
		fireEvent.click(
			within(queueRow(view, name, list)).getByRole("button", { name: "Open" }),
		),
	);
}
