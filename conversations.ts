import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, NodeFs } from "webappwiz/system";
import {
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import {
	type Agent,
	type Launch,
	launch,
	listSessions,
	type Session,
} from "./agent-process";
import { Conversation } from "./conversation";
import type { ConversationDeps } from "./conversation-host";
import type { Limit, Setting } from "./conversation-state";
import { fail } from "./exit";
import type { Limits } from "./limits";
import type { Offered } from "./offered";
import type { Watch } from "./watch";

export type {
	Agent,
	AgentProcess,
	Launch,
	Session,
} from "./agent-process";
export { launch } from "./agent-process";
export { Conversation } from "./conversation";
export type { ConversationEvents } from "./conversation-host";
export type {
	After,
	Answer,
	Ask,
	Attached,
	Background,
	BackgroundState,
	Checkpoint,
	Command,
	ConversationState,
	Decision,
	Edit,
	Field,
	Image,
	Limit,
	Message,
	Part,
	Setting,
	Status,
	Step,
	Tool,
	Upload,
	Usage,
} from "./conversation-state";
export { unused } from "./conversation-state";
export { fold, heard } from "./fold";

/** How many archived conversations are kept; older archived ones are deleted. */
export const ARCHIVED_KEPT = 50;

/** `changed` and `removed` each carry a conversation's id. */
export type ConversationsEvents = { changed: string; removed: string };

/**
 * Every conversation in the repo: the live ones this process started, and
 * the stopped ones read back from their logs, one JSON-lines file each under
 * `.git/arbor/conversations`.
 */
export class Conversations implements Eventful<ConversationsEvents>, Resource {
	private readonly dispatcher = new Dispatcher<ConversationsEvents>();
	readonly events = this.dispatcher.events;

	private readonly known = new Map<string, Conversation>();
	private readonly fs: Fs;
	private readonly ids: IdProvider;
	private readonly run: Launch;
	private readonly timer: Timer;
	private readonly clock: WallClock;
	private readonly watch: Watch | null;
	private readonly offered: Offered | null;
	private readonly limited: Limits | null;
	private readonly readLimits: ((agent: Agent) => Promise<Limit[]>) | null;
	private readonly root: string | null;
	/** The read of the records on disk, shared by every caller until it settles. */
	private loaded: Promise<void> | null = null;
	/** The last deletion of archived conversations past `ARCHIVED_KEPT`, so they run one at a time. */
	private pruning: Promise<void> = Promise.resolve();
	/** Where `arbor dev` answers, once it does, for the agents' CLI. */
	url: string | null = null;

	constructor(
		readonly dir: string,
		readonly agents: Agent[],
		opts: ConversationsOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ids = opts.ids ?? new UuidProvider();
		this.run = opts.launch ?? launch;
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemWallClock();
		this.watch = opts.watch ?? null;
		this.offered = opts.offered ?? null;
		this.limited = opts.limits ?? null;
		this.readLimits = opts.readLimits ?? null;
		this.root = opts.root ?? null;
	}

	/** What each conversation is made with, read as each starts, since `url` is set later. */
	private get deps(): ConversationDeps {
		return {
			fs: this.fs,
			timer: this.timer,
			clock: this.clock,
			launch: this.run,
			url: this.url,
			watch: this.watch,
			root: this.root,
		};
	}

	/**
	 * What each agent's sessions last offered, from any project, by its id:
	 * what a first conversation with one shows before it starts.
	 */
	async settings(): Promise<Record<string, Setting[]>> {
		return (await this.offered?.all()) ?? {};
	}

	/**
	 * Each agent's plan limits as it last said, from any project, by its id:
	 * what a new conversation shows before one here says.
	 */
	async limits(): Promise<Record<string, Limit[]>> {
		return (await this.limited?.all()) ?? {};
	}

	/** Every conversation, newest first. */
	async list(): Promise<Conversation[]> {
		await this.load();
		return [...this.known.values()].sort((one, other) =>
			other.state.createdAt.localeCompare(one.state.createdAt),
		);
	}

	async find(id: string): Promise<Conversation> {
		await this.load();
		const found = this.known.get(id);
		if (found === undefined) {
			fail("not_found", `no conversation ${id}`, { conversation: id });
		}
		return found;
	}

	/**
	 * Starts a conversation with `agent` in `cwd`, for `task` if it is one's,
	 * with `settings` set once the session offers them.
	 */
	async start(
		agent: string,
		{
			task,
			base,
			caller,
			cwd,
			settings,
			model,
		}: {
			task: string | null;
			/** The branch `task` was cut from. */
			base?: string | null;
			/** The conversation whose agent added `task`. */
			caller?: string | null;
			cwd: string;
			settings?: Record<string, string>;
			/** The model to start on, by its value or name in the model setting. */
			model?: string;
		},
	): Promise<Conversation> {
		const chosen = this.agents.find((each) => each.id === agent);
		if (chosen === undefined) {
			fail(
				"usage",
				`no agent '${agent}': use one of ${this.agents.map((each) => each.id).join(", ")}`,
				{ agent },
			);
		}
		await this.load();
		await this.fs.mkdir(this.dir);
		const id = this.ids.next();
		const conversation = await Conversation.start(
			{
				id,
				agent: chosen,
				task,
				base,
				caller,
				cwd,
				log: `${this.dir}/${id}.jsonl`,
				settings,
				model,
			},
			this.deps,
		);
		this.track(conversation);
		return conversation;
	}

	/**
	 * The sessions each agent holds in `cwd` that arbor does not, such as ones
	 * started in its CLI, to bring in: newest first, from every agent that
	 * lists and loads sessions.
	 */
	async sessions(cwd: string): Promise<Session[]> {
		await this.load();
		const held = new Set(
			[...this.known.values()].map(
				(each) => `${each.state.agent} ${each.sessionId}`,
			),
		);
		const listed = await Promise.all(
			this.agents.map((agent) =>
				listSessions(agent, cwd, this.run, this.timer).catch(
					(): Session[] => [],
				),
			),
		);
		return listed
			.flat()
			.filter((each) => !held.has(`${each.agent} ${each.session}`))
			.sort((one, other) =>
				(other.updatedAt ?? "").localeCompare(one.updatedAt ?? ""),
			);
	}

	/**
	 * Brings in `session`, one `agent` holds outside arbor, as a conversation
	 * in `cwd`, for `task` if it is one's.
	 */
	async bring(
		agent: string,
		session: string,
		{
			task,
			base,
			caller,
			cwd,
			title = null,
		}: {
			task: string | null;
			/** The branch `task` was cut from. */
			base?: string | null;
			/** The conversation whose agent added `task`. */
			caller?: string | null;
			cwd: string;
			title?: string | null;
		},
	): Promise<Conversation> {
		const chosen = this.agents.find((each) => each.id === agent);
		if (chosen === undefined) {
			fail(
				"usage",
				`no agent '${agent}': use one of ${this.agents.map((each) => each.id).join(", ")}`,
				{ agent },
			);
		}
		await this.load();
		const holding = [...this.known.values()].find(
			(each) => each.state.agent === agent && each.sessionId === session,
		);
		if (holding !== undefined) {
			fail(
				"usage",
				`session ${session} is already conversation ${holding.id}`,
				{ conversation: holding.id },
			);
		}
		await this.fs.mkdir(this.dir);
		const id = this.ids.next();
		const conversation = await Conversation.bring(
			{
				id,
				agent: chosen,
				session,
				title,
				task,
				base,
				caller,
				cwd,
				log: `${this.dir}/${id}.jsonl`,
			},
			this.deps,
		);
		this.track(conversation);
		return conversation;
	}

	/**
	 * Deletes the archived conversations past the `ARCHIVED_KEPT` archived
	 * most recently, so their logs do not pile up.
	 */
	prune(): Promise<void> {
		this.pruning = this.pruning.then(async () => {
			await this.load();
			await this.trim();
		});
		return this.pruning;
	}

	/** Stops every live conversation, so no agent outlives the server. */
	async disposeAsync(): Promise<void> {
		await Promise.all([...this.known.values()].map((each) => each.stop()));
	}

	dispose(): void {
		void this.disposeAsync();
	}

	private track(conversation: Conversation): void {
		this.known.set(conversation.id, conversation);
		// Only what changes from here: a log read back may be older than what
		// another project's sessions offered since.
		let remembered = conversation.state.settings;
		let archived = conversation.state.archived;
		let limits = conversation.state.usage.limits;
		let status = conversation.state.status;
		void this.limited
			?.remember(conversation.state.agent, limits)
			.catch(() => {});
		conversation.events.on("changed", () => {
			const { agent, settings } = conversation.state;
			if (settings !== remembered && settings.length > 0) {
				remembered = settings;
				void this.offered?.remember(agent, settings).catch(() => {});
			}
			// A turn ended: what the agent does not send is asked for.
			if (status === "running" && conversation.state.status === "idle") {
				this.askLimits(conversation);
			}
			status = conversation.state.status;
			if (conversation.state.usage.limits !== limits) {
				limits = conversation.state.usage.limits;
				void this.limited?.remember(agent, limits).catch(() => {});
			}
			if (conversation.state.archived && !archived) {
				void this.prune().catch(() => {});
			}
			archived = conversation.state.archived;
			this.dispatcher.dispatch("changed", conversation.id);
		});
		this.dispatcher.dispatch("changed", conversation.id);
	}

	/** Asks for `conversation`'s agent's limits, when it does not send them. */
	private askLimits(conversation: Conversation): void {
		const agent = this.agents.find(
			(each) => each.id === conversation.state.agent,
		);
		if (agent === undefined || this.readLimits === null) {
			return;
		}
		void this.readLimits(agent)
			.then((limits) => conversation.hear(limits))
			.catch(() => {});
	}

	private load(): Promise<void> {
		// Logs archived before any were deleted go as they are read back.
		this.loaded ??= this.read().then(() => this.trim());
		return this.loaded;
	}

	private async trim(): Promise<void> {
		const archived = [...this.known.values()]
			.filter((each) => each.state.archived)
			.sort((one, other) =>
				(other.archivedSince ?? "").localeCompare(one.archivedSince ?? ""),
			);
		for (const each of archived.slice(ARCHIVED_KEPT)) {
			this.known.delete(each.id);
			await each.delete();
			this.dispatcher.dispatch("removed", each.id);
		}
	}

	private async read(): Promise<void> {
		const names = (await this.fs.exists(this.dir))
			? await this.fs.readdir(this.dir)
			: [];
		for (const name of names.filter((each) => each.endsWith(".jsonl"))) {
			const read = await Conversation.read(
				`${this.dir}/${name}`,
				this.agents,
				this.deps,
			);
			if (read !== null && !this.known.has(read.id)) {
				this.track(read);
			}
		}
	}
}

export interface ConversationsOptions {
	fs?: Fs;
	ids?: IdProvider;
	launch?: Launch;
	timer?: Timer;
	clock?: WallClock;
	/** What watches the agents' commands for what they do to git; none by default. */
	watch?: Watch | null;
	/** Where what each agent's sessions offer is kept across projects; nowhere by default. */
	offered?: Offered | null;
	/** Where each agent's plan limits are kept across projects; nowhere by default. */
	limits?: Limits | null;
	/**
	 * Asks an agent that does not send its plan's windows for them, after
	 * each of its turns; none by default.
	 */
	readLimits?: ((agent: Agent) => Promise<Limit[]>) | null;
	/**
	 * The main tree, where a conversation carries on once its task's worktree
	 * is gone, as when the task landed while `arbor dev` was not there to hear
	 * of it; without it, such a conversation cannot resume.
	 */
	root?: string | null;
}
