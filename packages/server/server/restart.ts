// scry-ignore-file doc-comments-address-users: moved into server/ unchanged; it predates the rule
import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import type { After, Conversation, ConversationState } from "../conversations";
import { realName } from "../conversations";
import { fail } from "../exit";
import { RESUME } from "../plans";
import type { Projects } from "../projects";
import { shipsFrom } from "../ship";
import type { Document, Storage } from "../storage";
import { tasksOf } from "../tasks";
import type { Terminals } from "../terminal";
import { type Held, heldBy } from "../terminal";
import type { WorkerMachine } from "../workers";
import { type Project, type Served, waitingTasks } from "./project";
import type { ServerChoice } from "./servers";
import { RESTART, UPDATE } from "./supervise";
import type { Versions } from "./versions";

/** The projects `splates server` serves, as its restarts reach them. */
export interface ServedProjects {
	/** Each project opened so far, by root. */
	readonly served: Map<string, Promise<Served>>;
	/** The project at `root`, opened on first asking. */
	servedAt(root: string): Promise<Served>;
	/** The project `slug` names, or the focused one for none. */
	projectNamed(slug: string): Promise<Served>;
}

/** What `Restarts` works with: the machine, and what `splates server` holds. */
export interface RestartsHome {
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** The machine's storage, where a restart says which projects to reopen. */
	storage: Storage;
	/** The registry of splates projects. */
	projects: Projects;
	served: ServedProjects;
	terminals: Terminals;
	/** Where agents and shells run, whose process table says what a restart would kill. */
	machine: Pick<WorkerMachine, "processes">;
	/** Stops the whole server, before a restart ends the process. */
	server: AsyncResource;
	/** Hands every agent and shell on a worker to the next run, which takes them back; called before the server stops. */
	handOver(): Promise<void>;
}

/** What `Restarts` takes from `dev`'s options. */
export interface RestartsOptions {
	exit: ((code: number) => void) | null;
	open: (root: string) => Promise<Project>;
	/** Every `splates server` on this machine the page can switch to. */
	servers: () => Promise<ServerChoice[]>;
	/** How long a restart or shutdown waits on checkpoints, and again on stopping, before going on without them; the default is five minutes. */
	deadlineMs?: number;
}

const DEADLINE_MS = 5 * 60 * 1000;

/**
 * How `splates server` restarts: the checkpoint a restart waits on, the restart
 * itself, and how this run began. Its handlers are properties, so `dev` hands them to its routes
 * as they are.
 */
export class Restarts {
	/**
	 * The restart to follow the checkpoint under way, once every agent has
	 * answered, and whether the next run resumes them, or whether it shuts
	 * down instead, for the next start to resume them; null for none.
	 */
	private restarting: { resume: boolean; shutdown: boolean } | null = null;
	/**
	 * Whether the restart under way goes onto the newest splates, as
	 * `splates update` asks, even before a check of npm has found it.
	 */
	private updating = false;
	/**
	 * How this run began, when a checkpoint's restart started it: its agents
	 * `resuming`, told to carry on, until each has.
	 */
	private restarted: "resuming" | null = null;
	/**
	 * Whether `reopenStopped` has read how this run began, before which a
	 * checkpoint left in the logs may yet be one to resume.
	 */
	private began = false;
	/** This run of `splates server`, so a page can tell it has restarted. */
	private readonly run = crypto.randomUUID();
	/**
	 * Written by a checkpoint's restart, beside the registry, with the other
	 * projects whose agents it stopped, so the next run opens them at once
	 * and resumes them.
	 */
	private readonly reopen: Document<{ roots: string[] }>;
	// Projects read for their tasks alone, by root: opened, never served, so
	// listing them starts none of their agents.
	private readonly peeked = new Map<string, Promise<Project>>();
	/**
	 * How many agents wait in each project read for its tasks alone, as last
	 * counted, and the count under way: reading every task of a project takes
	 * a few hundred milliseconds, so a listing answers with the last count and
	 * leaves the next behind it, for the listing after.
	 */
	private readonly counted = new Map<
		string,
		{ count: number | null; counting: Promise<number> | null }
	>();
	/**
	 * The restart under way once its checkpoint is answered, until it has
	 * written what the next run reopens and handed over; disposing waits on
	 * it, so nothing is written after the server is gone.
	 */
	private leaving: Promise<boolean> = Promise.resolve(false);
	private disposed = false;

	constructor(
		private readonly home: RestartsHome,
		private readonly versions: Versions,
		private readonly opts: RestartsOptions,
	) {
		this.reopen = home.storage.document("restart.json");
	}

	/**
	 * Opens the projects a restart stopped agents in, and once they are
	 * served, tells each agent done with the checkpoint to carry on.
	 */
	async reopenStopped(): Promise<void> {
		const { projects, served } = this.home;
		const stopped = await this.reopen.read().catch(() => null);
		if (stopped === null) {
			this.began = true;
			return;
		}
		await this.reopen.remove();
		const roots = rootsOf(stopped);
		this.restarted = "resuming";
		this.began = true;
		const registered = await projects.list();
		const opening = roots
			.filter((root) =>
				registered.some((each) => each.root === root && !each.gone),
			)
			.map((root) => served.servedAt(root).catch(() => {}));
		void Promise.all(opening).then(() => this.carryOn());
	}

	// Each with the conversations a checkpoint would ask, or has asked, in
	// it: only those of a project this server has opened, since one not yet
	// opened has none running. And with how many agents wait on the person
	// there. Says whether a restart is to follow the checkpoint, and which run
	// this is, for the page to see it come back.
	readonly listProjects = async (): Promise<Response> => {
		if (
			this.restarted === "resuming" &&
			(await this.checkpointed()).length === 0
		) {
			this.restarted = null;
		}
		await this.forgetStale();
		// Read before the conversations, so a checkpoint asked meanwhile never
		// pairs its restart with agents not yet asked, which reads as restarting.
		const then = { restarting: this.restarting, restarted: this.restarted };
		const focused = await this.home.projects.focused();
		return Response.json({
			projects: await Promise.all(
				(await this.home.projects.list()).map(async (each) => ({
					...each,
					focused: each.root === focused?.root,
					conversations: await this.checkpointable(each.root),
					waiting: each.gone ? 0 : await this.waitingIn(each.root),
					ships: each.gone ? false : await shipsFrom(this.home, each.root),
				})),
			),
			servers: await this.opts.servers(),
			...then,
			run: this.run,
			running: this.versions.running,
			newest: this.versions.release?.newest ?? null,
			behind: this.versions.behind,
			restartable: this.opts.exit !== null,
			held: await this.holding(),
		});
	};

	/**
	 * Asks every live conversation in each project `projects` names, by slug,
	 * for a checkpoint, then restarts, or shuts down when `after` says to,
	 * once all of them have answered, stopping other projects' agents as they
	 * are; the next run tells each to carry on. With `update`, as `splates
	 * update` asks, it restarts onto the newest splates.
	 */
	readonly checkpointProjects = async (request: Request): Promise<Response> => {
		const read = (await request.json().catch(() => ({}))) as {
			projects?: unknown;
			after?: unknown;
			conversations?: unknown;
			update?: unknown;
		};
		const slugs = Array.isArray(read.projects) ? read.projects.map(String) : [];
		if (slugs.length === 0) {
			fail("usage", "name a project to checkpoint", {});
		}
		if (read.after !== "resume" && read.after !== "shutdown") {
			fail("usage", "say what follows the checkpoint: resume or shutdown", {});
		}
		const after: After = read.after;
		const only = Array.isArray(read.conversations)
			? read.conversations.map(String)
			: undefined;
		if (this.opts.exit === null) {
			fail(
				"usage",
				after === "shutdown"
					? "splates server cannot shut itself down here: stop it"
					: "splates server cannot restart itself here: restart it",
				{},
			);
		}
		// Held commands do not refuse it, unlike restartIdle: the page warns
		// of them first, and agents are asked only after this point.
		// One under way already restarts once its agents answer.
		if (read.update === true) {
			this.updating = true;
		}
		if (this.restarting !== null) {
			return Response.json({});
		}
		const chosen = await Promise.all(
			slugs.map((slug) => this.home.served.projectNamed(slug)),
		);
		this.restarted = null;
		// Under way while its agents are asked, so one done before the last
		// is asked is not forgotten as stale.
		const shutdown = after === "shutdown";
		this.restarting = { resume: true, shutdown };
		const asked: Promise<void>[] = [];
		try {
			for (const project of chosen) {
				asked.push(...(await project.checkpoint(only)));
			}
		} catch (error) {
			this.restarting = null;
			throw error;
		}
		this.restartAfter(asked, { shutdown });
		return Response.json({});
	};

	/**
	 * Restarts `splates server` now, or with `shutdown` exits for good, without a
	 * checkpoint: an agent at work stops mid-turn, and a command it would
	 * kill dies with it. The next run starts as if started afresh.
	 */
	readonly powerNow = async (request: Request): Promise<Response> => {
		const read = (await request.json().catch(() => ({}))) as {
			shutdown?: unknown;
		};
		const shutdown = read.shutdown === true;
		if (this.opts.exit === null) {
			fail(
				"usage",
				shutdown
					? "splates server cannot shut itself down here: stop it"
					: "splates server cannot restart itself here: restart it",
				{},
			);
		}
		this.restarted = null;
		this.restartAfter([], { reopens: false, shutdown });
		return Response.json({});
	};

	/**
	 * Restarts `splates server` now, refused while an agent is at work that a
	 * restart would stop (one on a worker carries on through it), or a
	 * command it would kill runs: a job in front in a shell, or one an idle
	 * agent left running.
	 */
	readonly restartIdle = async (): Promise<Response> => {
		if (this.opts.exit === null) {
			fail(
				"usage",
				"splates server cannot restart itself here: restart it",
				{},
			);
		}
		const working: { id: string; name: string }[] = [];
		for (const project of await this.opened()) {
			const lanes = await project.lanes();
			for (const each of (await project.conversations?.list()) ?? []) {
				const { state } = each;
				if (
					state.status === "starting" ||
					(state.status === "running" && each.handle === null)
				) {
					working.push({
						id: state.id,
						name: realName(state, lanes) ?? state.agent,
					});
				}
			}
		}
		if (working.length > 0) {
			fail(
				"usage",
				`agents are at work that a restart would stop: ${working.map((each) => each.name).join(", ")}`,
				{ conversations: working.map((each) => each.id) },
			);
		}
		const held = await this.holding();
		if (held.length > 0) {
			fail(
				"usage",
				`commands are running: ${held.map((each) => `${each.command} (${each.where})`).join(", ")}`,
				{ held },
			);
		}
		this.restartAfter([], { reopens: false });
		return Response.json({});
	};

	readonly forgetProject = async (request: Request): Promise<Response> => {
		const { projects, served } = this.home;
		const slug = new URL(request.url).pathname.split("/")[3] ?? "";
		const found = (await projects.list()).find((each) => each.slug === slug);
		if (found === undefined) {
			fail("not_found", `no splates project '${slug}'`, { project: slug });
		}
		// Its agents would carry on with nothing on the page left to show them.
		const live = await this.live(found.root);
		if (live.length > 0) {
			fail(
				"usage",
				`${slug} has conversations under way: stop ${live.map((each) => each.name).join(", ")} first`,
				{ project: slug, conversations: live.map((each) => each.id) },
			);
		}
		await projects.forget(found.root);
		this.counted.delete(found.root);
		const opened = served.served.get(found.root);
		served.served.delete(found.root);
		await (await opened?.catch(() => null))?.disposeAsync();
		// Where a page that showed it goes now: the one focused before it.
		return Response.json({ ...found, next: await projects.focused() });
	};

	/** Each project opened so far, but those that failed to open. */
	private async opened(): Promise<Served[]> {
		const all: Served[] = [];
		for (const settled of await Promise.allSettled(
			this.home.served.served.values(),
		)) {
			if (settled.status === "fulfilled") {
				all.push(settled.value);
			}
		}
		return all;
	}

	/**
	 * What a restart would kill: each command an idle agent left running,
	 * unless the agent runs on a worker, which keeps its commands as it keeps
	 * it; the page's shells run there too, and stay. An agent at work that a
	 * restart would stop holds one off on its own.
	 */
	private async holding(): Promise<Held[]> {
		const agents: { name: string; pid: number }[] = [];
		for (const project of await this.opened()) {
			const lanes = await project.lanes();
			for (const each of (await project.conversations?.list()) ?? []) {
				const { state, pid } = each;
				if (
					pid !== null &&
					each.handle === null &&
					state.status !== "running" &&
					state.status !== "starting"
				) {
					agents.push({ name: realName(state, lanes) ?? state.agent, pid });
				}
			}
		}
		if (agents.length === 0) {
			return [];
		}
		return heldBy(await this.home.machine.processes(), {
			shells: [],
			agents,
		});
	}

	// Those at work, or asked already: an idle one has no turn to stop. A
	// pause is the person's, and a budget stop the worker budget's, not Power's.
	private checkpointable(root: string) {
		return this.conversationsIn(
			root,
			(state) =>
				!state.pausing &&
				state.budgetStop === null &&
				(state.checkpoint !== null ||
					state.status === "running" ||
					state.status === "starting"),
		);
	}

	private live(root: string) {
		return this.conversationsIn(
			root,
			(state) => state.status !== "stopped" && state.status !== "failed",
		);
	}

	private async conversationsIn(
		root: string,
		keep: (state: ConversationState) => boolean,
	) {
		const project = await this.home.served.served.get(root)?.catch(() => null);
		const lanes = (await project?.lanes()) ?? [];
		return ((await project?.conversations?.list()) ?? [])
			.filter(({ state }) => keep(state))
			.map(({ state, handle }) => ({
				id: state.id,
				name: realName(state, lanes) ?? state.agent,
				status: state.status,
				checkpoint: state.checkpoint,
				survives: handle !== null,
			}));
	}

	// A served project counts its own; one not is read for its tasks alone,
	// where only an external agent can be at work, as last counted once it
	// has been. Its conversations go unread, so none taken by one counts as
	// abandoned.
	private async waitingIn(root: string): Promise<number> {
		const project = await this.home.served.served.get(root)?.catch(() => null);
		if (project) {
			return project.waiting();
		}
		let kept = this.counted.get(root);
		if (kept === undefined) {
			kept = { count: null, counting: null };
			this.counted.set(root, kept);
		}
		const entry = kept;
		if (entry.counting === null) {
			entry.counting = this.countWaiting(root).then(
				(count) => {
					entry.count = count;
					entry.counting = null;
					return count;
				},
				() => {
					entry.counting = null;
					return entry.count ?? 0;
				},
			);
		}
		return entry.count ?? (await entry.counting);
	}

	private async countWaiting(root: string): Promise<number> {
		let found = this.peeked.get(root);
		if (found === undefined) {
			found = this.opts.open(root);
			found.catch(() => this.peeked.delete(root));
			this.peeked.set(root, found);
		}
		const opened = await found.catch(() => null);
		if (opened === null) {
			return 0;
		}
		const tasks = await tasksOf(opened);
		return waitingTasks(tasks.map((task) => ({ ...task, takenBy: null })));
	}

	/**
	 * Restarts `splates server` once each checkpoint `asked` has been answered,
	 * unless dismissed meanwhile, or with `shutdown`, exits for good, the
	 * next start reopening and resuming as a restart would. Without
	 * `reopens`, the next run starts as if started afresh, as for a restart
	 * with every agent idle.
	 */
	private restartAfter(
		asked: Promise<void>[],
		{
			reopens = true,
			shutdown = false,
		}: { reopens?: boolean; shutdown?: boolean } = {},
	): void {
		const { log, server } = this.home;
		this.restarting = { resume: reopens, shutdown };
		const deadline = this.opts.deadlineMs ?? DEADLINE_MS;
		void within(deadline, Promise.all(asked)).then(async (answered) => {
			// The response that asked for this goes out before the server closes.
			await Bun.sleep(0);
			if (!answered) {
				log.error(
					`splates server went on without every checkpoint after ${Math.round(deadline / 1000)}s`,
				);
			}
			if (this.restarting === null || this.disposed) {
				return;
			}
			const leaving = this.leave(reopens, shutdown).catch((error) => {
				log.error(`splates server did not restart: ${String(error)}`);
				return false;
			});
			// Kept with any before it, as a power-now during a checkpoint's
			// restart starts a second, so disposing waits out both.
			const before = this.leaving;
			this.leaving = Promise.all([before, leaving]).then(([, left]) => left);
			if (!(await leaving)) {
				return;
			}
			if (!(await within(deadline, server.disposeAsync()))) {
				log.error("splates server did not stop in time: exiting anyway");
			}
			const { release } = this.versions;
			this.opts.exit?.(
				shutdown ? 0 : release === null && !this.updating ? RESTART : UPDATE,
			);
		});
	}

	/**
	 * Writes what the next run reopens and hands over, as a restart leaves;
	 * says whether to go on and exit, which a dispose meanwhile stops.
	 */
	private async leave(reopens: boolean, shutdown: boolean): Promise<boolean> {
		const { log, served } = this.home;
		if (reopens) {
			const roots: string[] = [];
			for (const [root, opened] of served.served) {
				const project = await opened.catch(() => null);
				const all = (await project?.conversations?.list()) ?? [];
				if (
					all.some(
						(each) =>
							each.stoppedByCheckpoint && each.state.budgetStop === null,
					)
				) {
					roots.push(root);
				}
			}
			await this.reopen.write({ roots });
		}
		const { release } = this.versions;
		log.info(
			shutdown
				? "splates server shutting down"
				: release === null
					? "splates server restarting"
					: `splates server restarting on splates ${release.newest}`,
		);
		// A shutdown ends the worker too: its agents stop, as ever.
		if (!shutdown) {
			const deadline = this.opts.deadlineMs ?? DEADLINE_MS;
			if (!(await within(deadline, this.home.handOver()))) {
				log.error("splates server did not hand over in time: going on");
			}
		}
		return !this.disposed;
	}

	/** Stops any restart not yet begun, and waits out the one under way. */
	async disposeAsync(): Promise<void> {
		this.disposed = true;
		await this.leaving;
	}

	/**
	 * Forgets each checkpoint ended with no run under way to restart or
	 * resume it: left by a run that stopped without saying to resume, as when
	 * killed mid-checkpoint, or in a project opened after the resume. Kept,
	 * it would hold Power on a checkpoint nothing ever ends.
	 */
	private async forgetStale(): Promise<void> {
		if (!this.began || this.restarting !== null || this.restarted !== null) {
			return;
		}
		for (const conversation of await this.checkpointed()) {
			if (conversation.state.checkpoint !== "asked") {
				conversation.dismissCheckpoint();
			}
		}
	}

	/**
	 * Each conversation a restart's checkpoint has asked, in every project:
	 * a pause and a budget stop are not its own to resume or forget.
	 */
	private async checkpointed(): Promise<Conversation[]> {
		const all: Conversation[] = [];
		for (const project of await this.opened()) {
			for (const each of (await project.conversations?.list()) ?? []) {
				const { checkpoint, pausing, budgetStop } = each.state;
				if (checkpoint !== null && !pausing && budgetStop === null) {
					all.push(each);
				}
			}
		}
		return all;
	}

	/**
	 * Tells each agent done with the checkpoint to carry on, which ends its
	 * checkpoint once said, and forgets the checkpoint of those it missed.
	 * One whose agent fails to come back has its checkpoint forgotten too,
	 * left failed for the person to open.
	 */
	private async carryOn(): Promise<void> {
		for (const conversation of await this.checkpointed()) {
			if (conversation.state.checkpoint === "done") {
				void conversation
					.prompt(RESUME)
					.catch(() => conversation.dismissCheckpoint());
			} else {
				conversation.dismissCheckpoint();
			}
		}
	}
}

/** What `restart.json` says: the projects to open. */
function rootsOf(parsed: { roots?: unknown }): string[] {
	return Array.isArray(parsed.roots) ? parsed.roots.map(String) : [];
}

/** Settles when `work` does, or after `ms`, saying whether it had by then. */
async function within(ms: number, work: Promise<unknown>): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<false>((resolve) => {
		timer = setTimeout(() => resolve(false), ms);
	});
	try {
		return await Promise.race([
			work.then(
				() => true,
				() => true,
			),
			late,
		]);
	} finally {
		clearTimeout(timer);
	}
}
