import type { Deps } from "webappwiz/cmd";
import type { Transcriber } from "webappwiz/dictate";
import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { Debouncer, SystemTimer } from "webappwiz/time";
import type { Assets } from "./assets";
import type { LaneRecord } from "./board";
import { SeenLaneTodos } from "./board";
import type { ConversationState, Conversations } from "./conversations";
import type { SecretStores } from "./creds";
import { CredRoutes } from "./creds";
import { ConversationEvents } from "./dev-conversation-events";
import { ConversationRoutes } from "./dev-conversation-routes";
import type { ConversationsHeard } from "./dev-conversation-stream";
import { ProjectWatch, SETTLE } from "./dev-project-watch";
import { TodoRoutes } from "./dev-todos";
import { LOCAL_WORKER } from "./dev-workers";
import type { TranscriberFor } from "./dictate";
import type { InstallationToken, Landed, LandRequest } from "./merge";
import { AutoRoutes } from "./models";
import { type Needing, needs } from "./plans";
import type { Everywhere, Projects } from "./projects";
import type { Format, Repository } from "./records";
import { answerState, type StateCall } from "./records";
import type { Behind, Release } from "./release";
import type { Slot } from "./slots";
import { BudgetRoutes } from "./stats";
import type { PortOwners } from "./task-ports";
import type { Details, Snapshot } from "./tasks";
import { HandedOut, startDispatched, TaskRoutes } from "./tasks";

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
	let handedOut: HandedOut | null = null;
	let todosWatch: Resource | null = null;
	let events: Resource | null = null;
	if (conversations !== null) {
		handedOut = HandedOut.watch({
			service,
			conversations,
			everywhere: context.everywhere,
			lanes: () => project.todos.lanes(),
			todos: () => project.todos.stored(),
			seen: new SeenLaneTodos(fs, `${splatesDir}/lane-todos.json`),
			log,
		});
		events = await ConversationEvents.follow({
			journal,
			conversations,
			fs,
			splatesDir,
			log,
		});
		conversations.url = context.url;
		let starting = Promise.resolve();
		const handOff = (): void => {
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
		// A todo merged or let go from any tree tells its lane's orchestrator
		// at once, not at the next sweep.
		const todosSettled = new Debouncer(new SystemTimer(), SETTLE);
		const watched = handedOut;
		try {
			await fs.mkdir(`${splatesDir}/todos`);
			const watching = fs.watch(`${splatesDir}/todos`, () =>
				todosSettled.call(() => void watched.sweep()),
			);
			todosWatch = {
				dispose: () => {
					watching.dispose();
					todosSettled.cancel();
				},
			};
		} catch (error) {
			log.error(
				`splates server cannot watch ${service.git.root}'s todos, so a lane's orchestrator hears of one merged or let go only at the next sweep: ${String(error)}`,
			);
		}
	}

	const talks = new ConversationRoutes(
		project,
		conversations,
		context.everywhere,
	);
	return {
		...new TaskRoutes(project, conversations, watch),
		...new TodoRoutes(project, talks, watch),
		...new CredRoutes(project, watch),
		...new BudgetRoutes(project),
		...new AutoRoutes(project, conversations),
		...talks,
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
			lanes: await project.todos.laneNames(),
		}),
		lanes: () => project.todos.laneNames(),
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
			todosWatch?.dispose();
			handedOut?.dispose();
			events?.dispose();
			await talks.disposeAsync();
		},
	};
}

/** What `dev` serves a project with: its own records, read and written. */
export type Project = Pick<
	Repository,
	| "service"
	| "journal"
	| "todos"
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
	retryTask: Handler;
	removeTask: Handler;
	addTodo: Handler;
	updateTodo: Handler;
	moveTodo: Handler;
	linkTodo: Handler;
	arrangeTodo: Handler;
	assignTodo: Handler;
	joinLane: Handler;
	addLane: Handler;
	updateLane: Handler;
	dropLane: Handler;
	removeTodo: Handler;
	restoreTodo: Handler;
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
	startAutoConversation: Handler;
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
	tellConversation: Handler;
	addArtifact: Handler;
	removeArtifact: Handler;
	deleteArtifactVersion: Handler;
	terminateConversation: Handler;
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
