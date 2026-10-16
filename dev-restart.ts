import type { AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { realName } from "./conversation-name";
import type { After, Conversation, ConversationState } from "./conversations";
import { type Project, type Served, waitingOn } from "./dev-project";
import type { ServerChoice } from "./dev-servers";
import type { Terminals } from "./dev-terminal";
import type { Versions } from "./dev-versions";
import { fail } from "./exit";
import { type Held, heldBy } from "./held";
import type { Projects } from "./projects";
import { RESUME } from "./prompts";
import { tasksOf } from "./snapshot";
import { RESTART, UPDATE } from "./supervise";
import type { WorkerMachine } from "./worker-machine";

/** The projects `arbor dev` serves, as its restarts reach them. */
export interface ServedProjects {
	/** Each project opened so far, by root. */
	readonly served: Map<string, Promise<Served>>;
	/** The project at `root`, opened on first asking. */
	servedAt(root: string): Promise<Served>;
	/** The project `slug` names, or the focused one for none. */
	projectNamed(slug: string): Promise<Served>;
}

/** What `Restarts` works with: the machine, and what `arbor dev` holds. */
export interface RestartsHome {
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** The registry of arbor projects. */
	projects: Projects;
	served: ServedProjects;
	terminals: Terminals;
	/** Where agents and shells run, whose process table says what a restart would kill. */
	machine: Pick<WorkerMachine, "processes">;
	/** Stops the whole server, before a restart ends the process. */
	server: AsyncResource;
}

/** What `Restarts` takes from `dev`'s options. */
export interface RestartsOptions {
	exit: ((code: number) => void) | null;
	open: (root: string) => Promise<Project>;
	/** Every `arbor dev` on this machine the page can switch to. */
	servers: () => Promise<ServerChoice[]>;
}

/**
 * How `arbor dev` restarts: the checkpoint a restart waits on, the restart
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
	 * How this run began, when a checkpoint's restart started it: its agents
	 * `resuming`, told to carry on, until each has.
	 */
	private restarted: "resuming" | null = null;
	/**
	 * Whether `reopenStopped` has read how this run began, before which a
	 * checkpoint left in the logs may yet be one to resume.
	 */
	private began = false;
	/** This run of `arbor dev`, so a page can tell it has restarted. */
	private readonly run = crypto.randomUUID();
	/**
	 * Written by a checkpoint's restart, beside the registry, with the other
	 * projects whose agents it stopped, so the next run opens them at once
	 * and resumes them.
	 */
	private readonly reopen: string;
	// Projects read for their tasks alone, by root: opened, never served, so
	// listing them starts none of their agents.
	private readonly peeked = new Map<string, Promise<Project>>();

	constructor(
		private readonly home: RestartsHome,
		private readonly versions: Versions,
		private readonly opts: RestartsOptions,
	) {
		const { path } = home.projects;
		this.reopen = `${path.slice(0, path.lastIndexOf("/"))}/restart.json`;
	}

	/**
	 * Opens the projects a restart stopped agents in, and once they are
	 * served, tells each agent done with the checkpoint to carry on.
	 */
	async reopenStopped(): Promise<void> {
		const { fs, projects, served } = this.home;
		const stopped = await fs.read(this.reopen).catch(() => null);
		if (stopped === null) {
			this.began = true;
			return;
		}
		await fs.rm(this.reopen, { force: true });
		const roots = parseRestart(stopped);
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
	 * are; the next run tells each to carry on.
	 */
	readonly checkpointProjects = async (request: Request): Promise<Response> => {
		const read = (await request.json().catch(() => ({}))) as {
			projects?: unknown;
			after?: unknown;
			conversations?: unknown;
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
					? "arbor dev cannot shut itself down here: stop it"
					: "arbor dev cannot restart itself here: restart it",
				{},
			);
		}
		// Held commands do not refuse it, unlike restartIdle: the page warns
		// of them first, and agents are asked only after this point.
		// One under way already restarts once its agents answer.
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
	 * Restarts `arbor dev` now, or with `shutdown` exits for good, without a
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
					? "arbor dev cannot shut itself down here: stop it"
					: "arbor dev cannot restart itself here: restart it",
				{},
			);
		}
		this.restarted = null;
		this.restartAfter([], { reopens: false, shutdown });
		return Response.json({});
	};

	/**
	 * Restarts `arbor dev` now, refused while any agent is at work, or a
	 * command it would kill runs: a job in front in a shell, or one an idle
	 * agent left running.
	 */
	readonly restartIdle = async (): Promise<Response> => {
		if (this.opts.exit === null) {
			fail("usage", "arbor dev cannot restart itself here: restart it", {});
		}
		const working: { id: string; name: string }[] = [];
		for (const project of await this.opened()) {
			const lanes = await project.lanes();
			for (const { state } of (await project.conversations?.list()) ?? []) {
				if (state.status === "running" || state.status === "starting") {
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
				`agents are at work: ${working.map((each) => each.name).join(", ")}`,
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
			fail("not_found", `no arbor project '${slug}'`, { project: slug });
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
	 * What a restart would kill: the job in front in each of the page's
	 * shells, and each command an idle agent left running. An agent at work
	 * holds a restart off on its own.
	 */
	private async holding(): Promise<Held[]> {
		const agents: { name: string; pid: number }[] = [];
		for (const project of await this.opened()) {
			const lanes = await project.lanes();
			for (const each of (await project.conversations?.list()) ?? []) {
				const { state, pid } = each;
				if (
					pid !== null &&
					state.status !== "running" &&
					state.status !== "starting"
				) {
					agents.push({ name: realName(state, lanes) ?? state.agent, pid });
				}
			}
		}
		const shells = this.home.terminals.pids;
		if (shells.length === 0 && agents.length === 0) {
			return [];
		}
		return heldBy(await this.home.machine.processes(), { shells, agents });
	}

	// Those at work, or asked already: an idle one has no turn to stop. A
	// pause is the person's, not Power's.
	private checkpointable(root: string) {
		return this.conversationsIn(
			root,
			(state) =>
				!state.pausing &&
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
			.map(({ state }) => state)
			.filter(keep)
			.map((state) => ({
				id: state.id,
				name: realName(state, lanes) ?? state.agent,
				status: state.status,
				checkpoint: state.checkpoint,
			}));
	}

	// A served project counts its own; one not is read for its tasks alone,
	// where only an external agent can be at work. Its conversations go
	// unread, so none taken by one counts as abandoned.
	private async waitingIn(root: string): Promise<number> {
		const project = await this.home.served.served.get(root)?.catch(() => null);
		if (project) {
			return project.waiting();
		}
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
		return waitingOn(
			tasks.map((task) => ({ ...task, takenBy: null })),
			[],
		);
	}

	/**
	 * Restarts `arbor dev` once each checkpoint `asked` has been answered,
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
		const { fs, log, served, server } = this.home;
		this.restarting = { resume: reopens, shutdown };
		void Promise.all(asked).then(async () => {
			if (this.restarting === null) {
				return;
			}
			if (reopens) {
				const roots: string[] = [];
				for (const [root, opened] of served.served) {
					const project = await opened.catch(() => null);
					const all = (await project?.conversations?.list()) ?? [];
					if (all.some((each) => each.stoppedByCheckpoint)) {
						roots.push(root);
					}
				}
				await fs.write(this.reopen, `${JSON.stringify({ roots })}\n`);
			}
			const { release } = this.versions;
			const code = shutdown ? 0 : release === null ? RESTART : UPDATE;
			log.info(
				shutdown
					? "arbor dev shutting down"
					: release === null
						? "arbor dev restarting"
						: `arbor dev restarting on arbor ${release.newest}`,
			);
			await server.disposeAsync();
			this.opts.exit?.(code);
		});
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

	/** Each conversation a checkpoint has asked, in every project. */
	private async checkpointed(): Promise<Conversation[]> {
		const all: Conversation[] = [];
		for (const project of await this.opened()) {
			const _lanes = await project.lanes();
			for (const each of (await project.conversations?.list()) ?? []) {
				if (each.state.checkpoint !== null && !each.state.pausing) {
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
function parseRestart(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw) as { roots?: unknown };
		return Array.isArray(parsed.roots) ? parsed.roots.map(String) : [];
	} catch {
		return [];
	}
}
