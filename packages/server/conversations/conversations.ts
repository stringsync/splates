import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, type Lock, MemoryLock, NodeFs } from "webappwiz/system";
import {
	SystemTimer,
	SystemWallClock,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { SessionServers, Watch } from "../agents";
import {
	type Agent,
	type Launcher,
	launch,
	launcherOf,
	type Session,
} from "../agents";
import { type ArtifactLimits, ArtifactRoom } from "../artifacts";
import { ARTIFACT_LIMITS, systemPs } from "../config";
import { fail } from "../exit";
import type { Limits, Offered } from "../models";
import type { NoteReads } from "../notes";
import { installedVersion } from "../server/shared";
import type { Used } from "../spend";
import type { Adherence, Outcomes } from "../stats";
import { FsStorage, type Storage } from "../storage";
import { LocalWorkerMachine, type WorkerMachine } from "../workers";
import { archivedNewestFirst } from "./archive";
import { Conversation, type Picked } from "./conversation";
import type {
	ConversationDeps,
	ConversationSlots,
	ConversationsEvents,
	Lift,
	PlacedCheckouts,
	ProjectRoster,
	Route,
} from "./host";
import type { ConversationsOptions } from "./options";
import { outside } from "./outside";
import { spent, usedOf } from "./spent";
import type { Limit, Setting } from "./state";

/** A conversation id as `UuidProvider` makes it, which a page may pick. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How long Codex's limits asked for stand before the Budget page asks again, in ms. */
const LIMITS_FRESH = 5 * 60_000;

/** How many archived conversations are kept; older archived ones are deleted. */
export const ARCHIVED_KEPT = 200;

/**
 * Every conversation in the repo: the live ones this process started, and
 * the stopped ones read back from their logs, one JSON-lines file each under
 * `.git/splates/conversations`.
 */
export class Conversations implements Eventful<ConversationsEvents>, Resource {
	private readonly dispatcher = new Dispatcher<ConversationsEvents>();
	readonly events = this.dispatcher.events;

	private readonly known = new Map<string, Conversation>();
	private readonly fs: Fs;
	/** Where the conversations are kept, each log `<id>.jsonl` in it. */
	private readonly storage: Storage;
	private readonly ids: IdProvider;
	private readonly launcher: Launcher;
	private readonly slots: ConversationSlots | undefined;
	private readonly checkouts: PlacedCheckouts | undefined;
	private readonly machine: WorkerMachine;
	private readonly starting: Lock;
	private readonly timer: Timer;
	private readonly clock: WallClock;
	private readonly watch: Watch | null;
	private readonly offered: Offered | null;
	private readonly limited: Limits | null;
	private readonly adherence: Adherence | null;
	private readonly noteReads: NoteReads | null;
	private readonly outcomes: Outcomes | null;
	private readonly spend: NonNullable<ConversationsOptions["spend"]> | null;
	private readonly readLimits: ((agent: Agent) => Promise<Limit[]>) | null;
	private readonly root: string | null;
	private readonly projects: ProjectRoster | null;
	private readonly servers: SessionServers | null;
	private readonly artifacts: ArtifactLimits;
	/** What every conversation's artifacts make room through, across the project. */
	private readonly room: ArtifactRoom;
	/** The read of the records on disk, shared by every caller until it settles. */
	private loaded: Promise<void> | null = null;
	/** The last deletion of archived conversations past `ARCHIVED_KEPT`, so they run one at a time. */
	private pruning: Promise<void> = Promise.resolve();
	/** When each agent's limits were last asked for, by its id, in epoch ms. */
	private readonly asked = new Map<string, number>();
	/** Where `splates server` answers, once it does, for the agents' CLI. */
	url: string | null = null;
	/** What looks again at what the person says in a conversation Auto pick started; null for nothing. */
	lift: Lift | null = null;
	/** What points each agent at the project notes that bear on what the person says; null for nothing. */
	route: Route | null = null;

	/** New starts use the refreshed roster; existing conversations retain their snapshot. */
	refreshRoster(agents: Agent[]): void {
		this.agents.splice(0, this.agents.length, ...structuredClone(agents));
		this.dispatcher.dispatch("settings");
	}

	constructor(
		readonly dir: string,
		readonly agents: Agent[],
		opts: ConversationsOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.storage = opts.storage ?? new FsStorage(dir, this.fs);
		this.ids = opts.ids ?? new UuidProvider();
		this.launcher = opts.launcher ?? launcherOf(opts.launch ?? launch);
		this.slots = opts.slots;
		this.checkouts = opts.checkouts;
		this.machine = opts.machine ?? new LocalWorkerMachine(systemPs(), this.fs);
		this.starting = opts.starting ?? new MemoryLock();
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemWallClock();
		this.watch = opts.watch ?? null;
		this.offered = opts.offered ?? null;
		this.limited = opts.limits ?? null;
		this.adherence = opts.adherence ?? null;
		this.noteReads = opts.noteReads ?? null;
		this.outcomes = opts.outcomes ?? null;
		this.spend = opts.spend ?? null;
		this.readLimits = opts.readLimits ?? null;
		this.root = opts.root ?? null;
		this.projects = opts.projects ?? null;
		this.servers = opts.servers ?? null;
		this.artifacts = opts.artifacts ?? ARTIFACT_LIMITS;
		this.room = new ArtifactRoom({
			storage: this.storage,
			capacity: this.artifacts.project,
			shelves: () =>
				[...this.known.values()].map((each) => ({
					store: each.artifacts,
					archived: each.state.archived,
				})),
		});
	}

	/** What each conversation is made with. */
	private get deps(): ConversationDeps {
		const conversations = this;
		return {
			// Read as each agent launches, since `url` is set after the project
			// opens, which reads back every conversation from before a restart.
			get url() {
				return conversations.url;
			},
			// Set once the project opens too, as Auto pick reads the project.
			get lift() {
				return conversations.lift;
			},
			get route() {
				return conversations.route;
			},
			fs: this.fs,
			storage: this.storage,
			dir: this.dir,
			ids: this.ids,
			artifacts: this.artifacts,
			room: this.room,
			timer: this.timer,
			clock: this.clock,
			launcher: this.launcher,
			...(this.slots === undefined ? {} : { slots: this.slots }),
			...(this.checkouts === undefined ? {} : { checkouts: this.checkouts }),
			machine: this.machine,
			starting: this.starting,
			watch: this.watch,
			root: this.root,
			projects: this.projects,
			servers: this.servers,
		};
	}

	/**
	 * What each agent's sessions last offered, from any project, by its id:
	 * what a first conversation with one shows before it starts.
	 */
	async settings(): Promise<Record<string, Setting[]>> {
		return (await this.offered?.all()) ?? {};
	}

	/** Whether each agent that connected here last said it takes images. */
	async sights(): Promise<Record<string, boolean>> {
		return (await this.offered?.sights()) ?? {};
	}

	/**
	 * Saves `value` as what `agent`'s new conversations start with for its
	 * setting `id`, one the agent offers, as picked before any is started.
	 */
	async chooseDefault(agent: string, id: string, value: string): Promise<void> {
		const settings = (await this.settings())[agent] ?? [];
		const setting = settings.find((each) => each.id === id);
		if (setting === undefined) {
			fail("usage", `agent '${agent}' has no setting '${id}'`);
		}
		if (!setting.options.some((option) => option.value === value)) {
			fail(
				"usage",
				`'${value}' is not a ${setting.name.toLowerCase()} this agent offers`,
			);
		}
		await this.offered?.choose(
			agent,
			settings.map((each) =>
				each.id === id ? { ...each, current: value } : each,
			),
			[id],
		);
		this.dispatcher.dispatch("settings");
	}

	/**
	 * Each agent's plan limits as it last said, from any project, by its id:
	 * what a new conversation shows before one here says.
	 */
	async limits(): Promise<Record<string, Limit[]>> {
		return (await this.limited?.all()) ?? {};
	}

	/**
	 * Asks each agent that does not send its limits for them, unless it was
	 * asked within `LIMITS_FRESH`, and keeps what it says for every project.
	 */
	async refreshLimits(): Promise<void> {
		const read = this.readLimits;
		if (read === null) {
			return;
		}
		const now = this.clock.now();
		await Promise.all(
			this.agents.map(async (agent) => {
				const before = this.asked.get(agent.id);
				if (before !== undefined && now - before < LIMITS_FRESH) {
					return;
				}
				this.asked.set(agent.id, now);
				const limits = await read(agent).catch((): Limit[] => []);
				await this.limited?.remember(agent.id, limits).catch(() => {});
			}),
		);
	}

	/** Every conversation, newest first. */
	async list(): Promise<Conversation[]> {
		await this.load();
		return [...this.known.values()].sort((one, other) =>
			other.state.createdAt.localeCompare(one.state.createdAt),
		);
	}

	/**
	 * The newest conversation started for persistent agent `role`, archived
	 * or not, or null before one started.
	 */
	async persistent(role: string): Promise<Conversation | null> {
		return (
			(await this.list()).find(({ state }) => state.persistent === role) ?? null
		);
	}

	/** `id`, as a page picked it for a new conversation: a UUID none has. */
	private unused(id: string): string {
		if (!UUID.test(id)) {
			fail("usage", `not a conversation id: ${id}`, { conversation: id });
		}
		if (this.known.has(id)) {
			fail("usage", `conversation ${id} already exists`, { conversation: id });
		}
		return id;
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
	 * with `settings` set once the session offers them; for `queued`, held
	 * for that queued task until the queue starts it.
	 */
	async start(
		agent: string,
		{
			id: given,
			task,
			base,
			caller,
			cwd,
			settings,
			model,
			assigned,
			startedBy,
			capped,
			queued,
			title,
			persistent,
			picking,
		}: {
			/**
			 * The id the page picked, so it opens the conversation before the
			 * server answers; a new one when not given.
			 */
			id?: string;
			task: string | null;
			/** The branch `task` was cut from. */
			base?: string | null;
			/** The conversation whose agent added `task`. */
			caller?: string | null;
			cwd: string;
			settings?: Record<string, string>;
			/** The model to start on, by its value or name in the model setting. */
			model?: string;
			/** Whether a queued task or `splates add --agent` assigned the agent and model. */
			assigned?: boolean;
			/** The lane orchestrator that handed it its task, which hears when it stops. */
			startedBy?: string | null;
			/** Whether the server's queue or a hook starts it, to hold a worker's slot. */
			capped?: boolean;
			/** The queued task it is held for, its agent unopened until `release`. */
			queued?: number;
			/** What to call it until its agent names it. */
			title?: string;
			/** The persistent agent's role it is started for, as `"groomer"`. */
			persistent?: string;
			/**
			 * What Auto pick decides, once it has, to open on in place of
			 * `agent`, `model` and `settings`, which it shows meanwhile.
			 */
			picking?: Promise<Picked<string>>;
		},
	): Promise<Conversation> {
		const chosen = this.agentOf(agent);
		await this.load();
		const id = given === undefined ? this.ids.next() : this.unused(given);
		const conversation = await Conversation.start(
			{
				id,
				agent: chosen,
				task,
				base,
				caller,
				cwd,
				settings,
				model,
				assigned,
				startedBy,
				capped,
				queued,
				title,
				persistent,
				picking: picking?.then((picked) => ({
					...picked,
					agent: this.agentOf(picked.agent),
				})),
				skill: await installedVersion(this.fs, this.root ?? cwd),
			},
			this.deps,
		);
		this.track(conversation, assigned ? undefined : settings);
		return conversation;
	}

	/** The agent `id` names, failing for one splates does not run. */
	private agentOf(id: string): Agent {
		const agent = this.agents.find((each) => each.id === id);
		if (agent === undefined) {
			fail(
				"usage",
				`no agent '${id}': use one of ${this.agents.map((each) => each.id).join(", ")}`,
				{ agent: id },
			);
		}
		return agent;
	}

	/**
	 * The sessions each agent holds in `cwd` that splates does not, such as ones
	 * started in its CLI, to bring in: newest first, from every agent that
	 * lists and loads sessions.
	 */
	async sessions(cwd: string): Promise<Session[]> {
		await this.load();
		return outside([...this.known.values()], this.agents, cwd, {
			launch: this.launcher.launch,
			timer: this.timer,
			starting: this.starting,
		});
	}

	/**
	 * Brings in `session`, one `agent` holds outside splates, as a conversation
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
		const chosen = this.agentOf(agent);
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
				skill: await installedVersion(this.fs, this.root ?? cwd),
			},
			this.deps,
		);
		this.track(conversation);
		return conversation;
	}

	/**
	 * Deletes the archived conversations past the `ARCHIVED_KEPT` archived
	 * most recently, so their logs do not pile up, their artifacts and
	 * attached files going with them.
	 */
	prune(): Promise<void> {
		this.pruning = this.pruning.then(async () => {
			await this.load();
			await this.trim();
		});
		return this.pruning;
	}

	/**
	 * Stops every live conversation, so no agent outlives the server; one
	 * still starting says what it was told once the next run reads it back.
	 */
	async disposeAsync(): Promise<void> {
		await Promise.all([...this.known.values()].map((each) => each.shutDown()));
	}

	/**
	 * Lets go of every agent a worker runs, for a coordinator started again
	 * to take back, and says whether there was any: the rest stop as ever.
	 */
	async detachAsync(): Promise<boolean> {
		const detached = await Promise.all(
			[...this.known.values()].map((each) => each.detach()),
		);
		return detached.some(Boolean);
	}

	dispose(): void {
		void this.disposeAsync();
	}

	private track(
		conversation: Conversation,
		picks?: Record<string, string>,
	): void {
		this.offered?.track(
			conversation,
			() => this.dispatcher.dispatch("settings"),
			picks,
		);
		this.known.set(conversation.id, conversation);
		let archived = conversation.state.archived;
		let limits = conversation.state.usage.limits;
		let status = conversation.state.status;
		this.noteReads?.follow(conversation.state);
		// When the running turn began; null when it began before this server.
		let turnStarted: string | null = null;
		// What it had used as the running turn began, for the ledger.
		let usedBefore: Used | null = null;
		let tokensBefore = 0;
		void this.limited
			?.remember(conversation.state.agent, limits)
			.catch(() => {});
		conversation.events.on("changed", () => {
			const { agent } = conversation.state;
			this.noteReads?.hear(conversation.state, conversation.cwd);
			// A turn ended: what the agent does not send is asked for.
			if (status === "running" && conversation.state.status === "idle") {
				this.askLimits(conversation);
			}
			if (status !== "running" && conversation.state.status === "running") {
				turnStarted = conversation.now();
				usedBefore = usedOf(conversation.state);
				tokensBefore = conversation.state.usage.opencode?.turns.length ?? 0;
			}
			// A turn ended, however it did: how it followed the skill may have
			// changed.
			if (status === "running" && conversation.state.status !== "running") {
				void this.adherence
					?.judge(
						conversation.state,
						this.root ?? conversation.cwd ?? "",
						conversation.now(),
					)
					.catch(() => {});
				// A task it merged wrote its outcome before the turn said its usage.
				const { outcomes } = this;
				if (outcomes !== null && turnStarted !== null) {
					void outcomes
						.creditSaved(
							conversation,
							this.storage.log(`${conversation.id}.jsonl`),
							turnStarted,
							conversation.now(),
						)
						.catch(() => {});
				}
				const { spend } = this;
				if (usedBefore !== null && spend !== null) {
					void spent(spend, conversation, {
						before: usedBefore,
						turnsBefore: tokensBefore,
						root: this.root,
						projects: this.projects,
					}).catch(() => {});
				}
				turnStarted = null;
				usedBefore = null;
			}
			const ended =
				(status === "running" && conversation.state.status !== "running") ||
				(status === "starting" && conversation.state.status === "failed");
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
			if (ended) {
				this.dispatcher.dispatch("ended", conversation.id);
			}
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
		const archived = archivedNewestFirst([...this.known.values()]);
		for (const each of archived.slice(ARCHIVED_KEPT)) {
			this.known.delete(each.id);
			await each.delete();
			this.dispatcher.dispatch("removed", each.id);
		}
		// Those archived before archiving cleaned artifacts up keep only what
		// their panel shows too.
		for (const each of archived.slice(0, ARCHIVED_KEPT)) {
			await each.artifacts.archive();
		}
	}

	private async read(): Promise<void> {
		// Each log is one of the names kept at the top, beside a collection
		// of its files.
		const names = await this.storage.collection("").list();
		for (const name of names.filter((each) => each.endsWith(".jsonl"))) {
			const read = await Conversation.read(name, this.agents, this.deps);
			if (read !== null && !this.known.has(read.id)) {
				this.track(read);
				read.sayUnsaid();
			}
		}
	}
}
