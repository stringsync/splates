// scry-ignore-file export-leads-the-file: moved into server/ unchanged; it predates the rule
import type { Deps } from "webappwiz/cmd";
import type { Transcriber } from "webappwiz/dictate";
import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { Debouncer, SystemTimer } from "webappwiz/time";
import type { LaneRecord } from "../board";
import { BoardRoutes } from "../board";
import type {
	ConversationState,
	Conversations,
	ConversationsHeard,
} from "../conversations";
import {
	ConversationRoutes,
	JournalEvents,
	SERVER_TOLD,
} from "../conversations";
import type { SecretStores } from "../creds";
import { CredRoutes } from "../creds";
import type { TranscriberFor } from "../dictate";
import { fail } from "../exit";
import {
	HookRunner,
	HookStore,
	type Hooks,
	type TaskEventName,
} from "../hooks";
import type { InstallationToken, Landed, LandRequest } from "../merge";
import { type AgentPick, Roster, splatesHome } from "../models";
import { eventReference, type Needing, needs } from "../plans";
import type { PortOwners, Slot } from "../ports";
import type { Everywhere, Projects } from "../projects";
import { QueueRunner } from "../queue";
import type { Format, Repository } from "../records";
import { answerState, type StateCall } from "../records";
import { BudgetRoutes } from "../stats";
import type { Details, Snapshot } from "../tasks";
import { startDispatched, TaskRoutes } from "../tasks";
import { LOCAL_WORKER, type SlotRequest } from "../workers";
import type { Assets } from "./assets";
import { heldFor } from "./held";
import { ProjectWatch, SETTLE } from "./project-watch";
import type { Behind, Release } from "./release";

/**
 * Everything one project's page talks to: its records, its stream of
 * changes and its conversations, kept from the first request for it until
 * the server stops.
 */
export async function serveProject(
	project: Project,
	context: DevContext,
): Promise<Served> {
	const { service, format, splatesDir, fs, log, journal } = project;
	const watch = await ProjectWatch.start(project, context);
	const conversations = context.conversationsFor(project);
	// A task `splates add --agent` handed to an agent starts it, whether or
	// not a page listens, so its records are watched all along. One run at
	// a time, so none starts a task the run before it is starting.
	let handOffs: Resource | null = null;
	let queueRunner: QueueRunner | null = null;
	let unwatchRoom: (() => void) | null = null;
	let hookRunner: HookRunner | null = null;
	let events: Resource | null = null;
	if (conversations !== null) {
		queueRunner = QueueRunner.watch({
			queued: () => project.tasks.stored(),
			tasks: async () => (await service.list()).map(({ task }) => task),
			room: () => context.workerRoom(),
			want: (waiting) =>
				context.wantWorkers(
					service.git.root,
					waiting.map(({ queued, pick }) => ({
						id: `#${queued.id}`,
						project: service.git.root,
						task: `#${queued.id} ${queued.subject}`,
						platform: service.config.platform,
						agent: pick.agent,
					})),
				),
			fallback: async () => {
				const [first] = await new Roster(
					`${splatesHome(project.ps)}/agents.json`,
					{ fs },
				).agents();
				return { agent: first?.id ?? "claude" };
			},
			start: ({ task, queued, pick, prompt, held }) =>
				startQueuedTask(project, context.url, {
					task,
					number: queued.id,
					pick,
					prompt,
					held,
				}),
			held: heldFor(conversations, service, log),
			log,
		});
		const queue = queueRunner;
		unwatchRoom = context.onWorkerRoom(() => void queue.sweep());
		const hookStore = new HookStore(`${splatesDir}/hooks.json`, fs);
		events = await JournalEvents.follow({
			journal,
			conversations,
			fs,
			splatesDir,
			log,
		});
		const root = service.git.root;
		hookRunner = await HookRunner.follow({
			journal,
			fs,
			splatesDir,
			hooks: async () =>
				withCheckedIn(await hookStore.read(), project.config.on),
			seen: `${splatesDir}/hooks-seen.json`,
			actions: {
				run: async (command, event) => {
					const { exitCode, stderr } = await project.ps.spawnCapture(
						["sh", "-c", command],
						{
							cwd: root,
							env: {
								SPLATES_EVENT: event.name,
								SPLATES_TASKS: event.numbers.join(","),
								SPLATES_TASK: event.task ?? "",
							},
						},
					);
					if (exitCode !== 0) {
						throw new Error(
							stderr.trim() || `\`${command}\` exited ${exitCode}`,
						);
					}
				},
				agent: async (hook, event) => {
					const conversation = await conversations.start(hook.agent, {
						task: null,
						cwd: root,
						model: hook.model,
						assigned: true,
						capped: true,
					});
					void conversation
						.prompt(
							`${eventReference(event.name, event.numbers, event.task)}\n\n${hook.prompt}`,
							[],
							undefined,
							{
								told: SERVER_TOLD,
							},
						)
						.catch((error: unknown) =>
							log.error(`a hook's agent could not start: ${String(error)}`),
						);
				},
			},
			log,
		});
		conversations.url = context.url;
		let starting = Promise.resolve();
		const handOff = (): void => {
			// A task gone moves the queue on.
			void queue.sweep();
			starting = starting
				.then(() => startDispatched({ service, conversations, log }))
				.catch((error: unknown) => log.error(String(error)));
		};
		const settled = new Debouncer(new SystemTimer(), SETTLE);
		try {
			const watching = fs.watch(`${splatesDir}/tasks`, () =>
				settled.call(handOff),
			);
			handOffs = {
				dispose: () => {
					watching.dispose();
					settled.cancel();
				},
			};
		} catch (error) {
			log.error(
				`splates server cannot watch ${service.git.root}'s tasks, so it starts a task handed to an agent only as it starts: ${String(error)}`,
			);
		}
		handOff();
	}

	const talks = new ConversationRoutes(
		project,
		conversations,
		context.everywhere,
	);
	return {
		...new TaskRoutes(project, conversations, watch),
		...new BoardRoutes(project, talks, watch),
		...new CredRoutes(project, watch),
		...new BudgetRoutes(project),
		...talks,
		retryQueued: async (request) => {
			const raw = new URL(request.url).pathname.split("/")[3] ?? "";
			const id = Number(raw);
			if (!Number.isInteger(id) || id <= 0) {
				fail("usage", `'${raw}' is not a task id`, { number: raw });
			}
			await queueRunner?.retry(id);
			return new Response(null, { status: 204 });
		},
		root: service.git.root,
		format,
		conversations,
		land: (request) => project.trunk.land(request),
		mintToken: () => project.branches.mint(),
		answerState: async (call) => {
			const value = await answerState(fs, project.splatesDir, call);
			if (!READS.has(call.op)) {
				watch.changed();
			}
			return value;
		},
		refresh: watch.changed,
		snapshot: async () => Response.json(await watch.current()),
		current: () => watch.current(),
		waiting: async () =>
			waitingOn(
				(await watch.current()).tasks,
				((await conversations?.list()) ?? []).map(({ state }) => state),
			),
		needing: async () => ({
			rows: needs({
				tasks: (await watch.current()).tasks,
				conversations: ((await conversations?.list()) ?? []).map(
					({ state }) => state,
				),
			}),
			lanes: await project.tasks.laneNames(),
		}),
		lanes: () => project.tasks.laneNames(),
		portOwners: async () => ({
			worktrees: (await service.list())
				.filter((each) => each.exists)
				.map(({ task, path, machine }) => ({
					task,
					path,
					worker: machine ?? LOCAL_WORKER,
				})),
			agents: ((await conversations?.list()) ?? []).flatMap(
				({ state, pid, handle }) =>
					state.task !== null && pid !== null
						? [
								{
									task: state.task,
									pid,
									worker: handle?.worker ?? LOCAL_WORKER,
								},
							]
						: [],
			),
		}),
		events: async () => watch.events(),
		listen: (heard) => {
			const board = watch.listen(() => heard.board());
			const unlisten = talks.listen(heard);
			return {
				dispose: () => {
					board.dispose();
					unlisten();
				},
			};
		},
		transcriber: () => context.transcriberFor(project, () => watch.tick()),
		async disposeAsync() {
			watch.dispose();
			handOffs?.dispose();
			queueRunner?.dispose();
			unwatchRoom?.();
			hookRunner?.dispose();
			events?.dispose();
			await talks.disposeAsync();
		},
	};
}

/**
 * Adds the task the queue starts for queued task `number`, as `splates add
 * --task --agent` would, run as this splates so it is the same one:
 * `splates server` then starts its agent, holding a worker's slot. Throws
 * with what `add` said on a refusal.
 */
async function startQueuedTask(
	{ ps, service }: Project,
	url: string | null,
	{
		task,
		number,
		pick,
		prompt,
		held,
	}: {
		task: string;
		number: number;
		pick: AgentPick;
		prompt: string;
		held?: string;
	},
): Promise<void> {
	const { exitCode, stderr } = await ps.spawnCapture(
		[
			...ps.self,
			"add",
			task,
			"--task",
			String(number),
			"--agent",
			pick.agent,
			...(pick.model === undefined ? [] : ["--model", pick.model]),
			...(pick.effort === undefined ? [] : ["--effort", pick.effort]),
			"--prompt",
			prompt,
			...(held === undefined ? [] : ["--held", held]),
		],
		{
			cwd: service.git.root,
			env: url === null ? {} : { SPLATES_DEV: url },
			// Whatever agent started this server, the task is the queue's.
			unset: ["SPLATES_STARTED_BY", "SPLATES_CONVERSATION"],
		},
	);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || `splates add exited ${exitCode}`);
	}
}

/** What `dev` serves a project with: its own records, read and written. */
export type Project = Pick<
	Repository,
	| "service"
	| "config"
	| "journal"
	| "tasks"
	| "format"
	| "splatesDir"
	| "git"
	| "creds"
	| "slots"
	| "trunk"
	| "branches"
> & { fs: Fs; ps: Ps; log: Logger };

/**
 * What `dev` runs with: the machine's, not any project's, since it serves
 * every registered project wherever it was started.
 */
export type DevMachine = Deps & {
	fs: Fs;
	/** Where each project's creds are kept; the system's stores by default. */
	secrets?: SecretStores;
	/** How setup's checks reach the network; the global fetch by default. */
	fetch?: typeof fetch;
	/** The built page. */
	assets: Assets;
	/** Every splates project on this machine. */
	projects: Projects;
	/**
	 * Projects opened already, served as they are rather than opened again:
	 * a test's own, with its fakes.
	 */
	opened?: Project[];
};

/** What the server as a whole tells each project it serves. */
export interface DevContext {
	/** Where the agents' own `splates` reaches this server, once it listens. */
	readonly url: string | null;
	/** A newer splates on npm, once a check has found one; every page says so. */
	readonly release: Release | null;
	/** Commits to splates's own source since this run started, once seen. */
	readonly behind: Behind | null;
	/** Whether building the page failed, so it serves the one built before. */
	readonly unbuilt: boolean;
	/** The slot `splates server --slot` serves under, or null. */
	readonly slot: Slot | null;
	/** The conversations `project`'s page may hold, or null when they are off. */
	conversationsFor(project: Project): Conversations | null;
	/** Every served project's conversations, where a caller of one may be. */
	readonly everywhere: Everywhere;
	/** How many more agents the workers could start now without waiting. */
	workerRoom(): number;
	/** Calls `listener` whenever the workers' slots change, until the call it gives back. */
	onWorkerRoom(listener: () => void): () => void;
	/** Sets the slots the queued tasks of the project at `root` wait for. */
	wantWorkers(root: string, requests: SlotRequest[]): void;
	/** What `project`'s dictations transcribe with. */
	readonly transcriberFor: TranscriberFor;
}

/** A route's work once its project is known. */
export type Handler = (request: Request) => Promise<Response>;

/** One project as the server holds it: what each of its routes does. */
export interface Served extends AsyncResource {
	root: string;
	format: Format;
	conversations: Conversations | null;
	/** Runs a worker's call on its records, as `POST /api/state` asks. */
	answerState: (call: StateCall) => Promise<unknown>;
	/** Moves trunk to a worker's tested branch, as `POST /api/land` asks. */
	land: (request: LandRequest) => Promise<Landed>;
	/** A token for its repository's git, as `POST /api/token` asks; null without the App. */
	mintToken: () => Promise<InstallationToken | null>;
	/** Reads the repo again soon, telling its pages if anything moved. */
	refresh: () => void;
	snapshot: Handler;
	/**
	 * Everything its page shows, kept from the last read while nothing in the
	 * repo moved, so reading it for every project costs little.
	 */
	current: () => Promise<Snapshot>;
	/** How many of its agents wait on the person. */
	waiting: () => Promise<number>;
	/** What each of its agents needs, and the lanes that name an orchestrator. */
	needing: () => Promise<{ rows: Needing[]; lanes: LaneRecord[] }>;
	/** Every lane there has been, to name an orchestrator after. */
	lanes: () => Promise<LaneRecord[]>;
	/** Its tasks' worktrees and agents, whose processes' ports are the tasks'. */
	portOwners: () => Promise<PortOwners>;
	events: Handler;
	/**
	 * Tells `heard` of each move its pages would hear, listening as a page
	 * does, until disposed.
	 */
	listen: (heard: ProjectHeard) => Resource;
	file: Handler;
	open: Handler;
	paths: Handler;
	diff: Handler;
	finishedTasks: Handler;
	finishedTask: Handler;
	retryTask: Handler;
	removeTask: Handler;
	addQueued: Handler;
	updateQueued: Handler;
	moveQueued: Handler;
	linkQueued: Handler;
	arrangeQueued: Handler;
	assignQueued: Handler;
	queueQueued: Handler;
	moveInQueue: Handler;
	/** Tries a queued task's refused start again. */
	retryQueued: Handler;
	joinLane: Handler;
	addLane: Handler;
	updateLane: Handler;
	dropLane: Handler;
	removeQueued: Handler;
	restoreQueued: Handler;
	listCreds: Handler;
	saveCred: Handler;
	removeCred: Handler;
	dismissCred: Handler;
	listBudgets: Handler;
	setBudget: Handler;
	raiseBudget: Handler;
	endRaise: Handler;
	pauseBudget: Handler;
	resumeBudget: Handler;
	listConversations: Handler;
	showConversation: Handler;
	refreshLimits: Handler;
	startConversation: Handler;
	listSessions: Handler;
	bringSession: Handler;
	/**
	 * Asks every live conversation here to bring its SPLATES.md up to date,
	 * answering with what settles as each answers; with `budget`, those
	 * `only` names, for a worker budget hard stop.
	 */
	checkpoint: (
		only?: string[],
		budget?: string | null,
	) => Promise<Promise<void>[]>;
	moveConversation: Handler;
	promptConversation: Handler;
	addArtifact: Handler;
	removeArtifact: Handler;
	deleteArtifactVersion: Handler;
	conversationAttachment: Handler;
	conversationArtifact: Handler;
	answerConversation: Handler;
	cancelConversation: Handler;
	pauseConversation: Handler;
	stopBackground: Handler;
	backgroundOutput: Handler;
	unqueueConversation: Handler;
	sendQueuedNow: Handler;
	chooseSetting: Handler;
	renameConversation: Handler;
	markUnread: Handler;
	pinConversation: Handler;
	reparentConversation: Handler;
	archiveConversation: Handler;
	conversationEvents: Handler;
	terminalTree: (request: Request) => Promise<string>;
	/**
	 * What a dictation transcribes with, read afresh for each take; null,
	 * after asking for the key on the Creds page, without one.
	 */
	transcriber: () => Promise<Transcriber | null>;
}

/** What a listener other than a page hears of one project. */
export interface ProjectHeard extends ConversationsHeard {
	/** Something its snapshot holds moved, such as a task. */
	board(): void;
}

/**
 * How many agents wait on the person, as the page's own waiting line counts
 * them, but for an external agent whose reply the page copied: only the page
 * knows that.
 */
export function waitingOn(
	tasks: Details[],
	conversations: ConversationState[],
): number {
	return needs({ tasks, conversations }).filter(
		({ need }) => need.kind === "waiting",
	).length;
}

/** The calls on a project's records that change nothing. */
const READS = new Set<StateCall["op"]>([
	"exists",
	"read",
	"readBytes",
	"readdir",
	"stat",
	"isSymlink",
]);

/** The person's hooks, with the shell commands the project checks in run after them. */
function withCheckedIn(
	hooks: Hooks,
	on: Partial<Record<TaskEventName, string>>,
): Hooks {
	const all: Hooks = { ...hooks };
	for (const [event, command] of Object.entries(on)) {
		const name = event as TaskEventName;
		all[name] = [...(all[name] ?? []), { kind: "run", command }];
	}
	return all;
}
