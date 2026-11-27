import type { Deps } from "core/cmd";
import type { Transcriber } from "core/dictate";
import type { AsyncResource, Resource } from "core/disposable";
import type { Logger } from "core/log";
import type { Fs, Ps } from "core/system";
import type { Launcher } from "../agents/process";
import type { ElsewhereBoards, LaneRecord } from "../board";
import type { Conversations, ConversationsHeard } from "../conversations";
import type { SecretStores } from "../creds";
import type { TranscriberFor } from "../dictate";
import type { ClockShelf } from "../hooks";
import type { Needing } from "../plans";
import type { PortOwners, RigProxyTargets, Slot } from "../ports";
import type { Everywhere, Projects } from "../projects";
import type { Format, Journal, Repository } from "../records";
import type { ReplicaStatus } from "../replica";
import type { RigSlots } from "../rigs";
import type { Waiting } from "../ship";
import type { SignalFunction, SignalRaise } from "../signals";
import type { Snapshot } from "../tasks";
import type { TrustStore } from "../trust";
import type { Assets } from "./assets";
import type { Behind, Release, Stuck } from "./release";
import type { Replicas } from "./replicas";

/** What `dev` serves a project with: its own records, read and written. */
export type Project = Pick<
	Repository,
	| "service"
	| "config"
	| "journal"
	| "tasks"
	| "format"
	| "dir"
	| "storage"
	| "git"
	| "creds"
	| "slots"
	| "trunk"
	| "branches"
	| "lock"
	| "premerge"
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
	/** Upstream server commits the local source checkout has not followed yet. */
	readonly stuck?: Stuck | null;
	/** Whether building the page failed, so it serves the one built before. */
	readonly unbuilt: boolean;
	/** The slot `splates server --slot` serves under, or null. */
	readonly slot: Slot | null;
	/** The replicators of every project, which `serveProject` leaves to run on. */
	readonly replicas: Replicas;
	/** The conversations `project`'s page may hold, or null when they are off. */
	conversationsFor(project: Project): Conversations | null;
	/** Every served project's conversations, where a caller of one may be. */
	readonly everywhere: Everywhere;
	/** Trust scores across projects, which gate merges on plan approval. */
	readonly trust?: TrustStore;
	/**
	 * The other projects' boards, which its tasks may wait on; absent, as in
	 * a test of one project, none is read.
	 */
	readonly boards?: ElsewhereBoards;
	/** The ports host a tunnel-exposed run's remote links go through, as `<animal>.<base>`; absent or null for none. */
	readonly portsBase?: string | null;
	/** Animal slots assigned to tunnel-exposed rigs; absent, each project uses its own pool. */
	readonly rigSlots?: RigSlots;
	/** Called after a tunnel-exposed rig claims an animal slot (e.g. to clear stale slot DNS). */
	readonly onRigSlotClaimed?: (slot: Slot) => Promise<void>;
	/** What starts a ship's steps on a worker and takes them back after a restart; absent, each is a child of this server. */
	readonly shipLauncher?: Launcher;
	/** What tasks that close on a signal read of it: its raises, and a probe to run on subscribing; absent, as in a test of one project, none close. */
	signalTasks?: {
		raises(): Promise<Record<string, SignalRaise[]>>;
		subscribed(name: string): Promise<void>;
	};
	/** Calls `listener` whenever the workers' slots change, until the call it gives back. */
	onWorkerRoom(listener: () => void): () => void;
	/** Raises the signal `name` for every conversation waiting on it; absent, as in a test of one project, none is raised. */
	raiseSignal?(name: string, by: string, payload: unknown): Promise<void>;
	/** Where clock schedules are kept, for moving saved schedules onto clocks; absent, as in a test of one project, none move. */
	clockShelf?(): ClockShelf;
	/** Whether everything splates starts on its own waits, the person's own agents alone starting. */
	paused(): boolean;
	/** What `project`'s dictations transcribe with. */
	readonly transcriberFor: TranscriberFor;
}

/** A route's work once its project is known. */
export type Handler = (request: Request) => Promise<Response>;

/** One project as the server holds it: what each of its routes does. */
export interface Served extends AsyncResource {
	root: string;
	/** Its journal, for the events the server logs on its behalf. */
	journal: Journal;
	format: Format;
	conversations: Conversations | null;
	/** Lets go of the ship steps and rig runs a worker runs for a restart to take back; whether there were any. */
	detachWork: () => Promise<boolean>;
	/** Reads the repo again soon, telling its pages if anything moved. */
	refresh: () => void;
	/** The signal functions its `splates.config.ts` declares. */
	signalFunctions: () => Record<string, SignalFunction>;
	/** Fires its automations set on signal `name`; how many fired. */
	/** Pauses automations whose source has expired. */
	expireSignal: (name: string, why?: string) => Promise<void>;
	/** Pauses its automations on a signal function not in `known`. */
	retireFamilies: (known: Record<string, unknown>) => Promise<void>;
	signalRaised: (name: string, by: string, payload: unknown) => Promise<number>;
	/** How many of its automations, not paused, are set on signal `name`: each keeps a probe on it running. */
	signalAutomations: (name: string) => Promise<number>;
	/** Every automation set on a signal, paused or not. */
	signalAutomationList: () => Promise<
		{
			id: string;
			name: string | null;
			signal: string;
			paused: boolean;
			/** Set for a board task that closes on the signal. */
			task?: number;
		}[]
	>;
	snapshot: Handler;
	/**
	 * Read the project snapshot to display its current tasks and conversations.
	 */
	current: () => Promise<Snapshot>;
	/** How many of its agents wait on the person. */
	waiting: () => Promise<number>;
	/** What each of its agents needs, and the lanes that name an orchestrator. */
	needing: () => Promise<{ rows: Needing[]; lanes: LaneRecord[] }>;
	/** Every prompt its ship runs have open, waiting on the person. */
	shipPrompts: () => Promise<Waiting[]>;
	/** Every lane there has been, to name an orchestrator after. */
	lanes: () => Promise<LaneRecord[]>;
	/** Its tasks' worktrees and agents, whose processes' ports are the tasks'. */
	portOwners: () => Promise<PortOwners>;
	/** Its live tunnel-exposed rig routes and ports excluded from splates's proxy. */
	rigProxyTargets: () => RigProxyTargets;
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
	questions: Handler;
	commitDiff: Handler;
	finishedTasks: Handler;
	mergeEstimates: Handler;
	quarantined: Handler;
	mergeOutput: Handler;
	finishedTask: Handler;
	retryTask: Handler;
	bumpMerge: Handler;
	/** Runs a merge `splates merge` hands the server. */
	startMerge: Handler;
	/** What a merge the server runs has said, and how it ended. */
	readMerge: Handler;
	/** Forgets a merge's end, once its `splates merge` has read it. */
	doneMerge: Handler;
	removeTask: Handler;
	addQueued: Handler;
	updateQueued: Handler;
	moveQueued: Handler;
	linkQueued: Handler;
	elsewhereTasks: Handler;
	arrangeQueued: Handler;
	assignQueued: Handler;
	queueQueued: Handler;
	moveInQueue: Handler;
	/** Tries a queued task's refused start again. */
	retryQueued: Handler;
	/** Reads this project's agent auto-queue settings. */
	readAgentSettings: Handler;
	/** Reads which agent-queued tasks wait for the quota reserve, by task id. */
	quotaReserveHolds: Handler;
	/** Saves this project's agent auto-queue settings (user page only). */
	saveAgentSettings: Handler;
	/** Decides whether an agent conversation may run `splates queue add`. */
	authorizeAgentQueue: Handler;
	/** Adds to the asking agent's chain budget, or stops auto for the chain. */
	changeChainBudget: Handler;
	/** Reads what each agent-queued task chain has spent, by root conversation. */
	chainSpends: Handler;
	readChain: Handler;
	addLane: Handler;
	addBoard: Handler;
	renameBoard: Handler;
	updateLane: Handler;
	moveBoard: Handler;
	dropLane: Handler;
	updateBoard: Handler;
	dropBoard: Handler;
	removeQueued: Handler;
	restoreQueued: Handler;
	/** The rigs the `rigs` commands declare, their runs, and where they may start. */
	rigs: Handler;
	/** Starts a run of a rig. */
	rigStart: Handler;
	/** Stops a run, or dismisses an exited one. */
	rigStop: Handler;
	/** A run's log after a line. */
	rigLog: Handler;
	/** Saves or drops a preset of a rig's options. */
	rigPresets: Handler;
	/** The targets the `ships` commands serve. */
	shipTargets: Handler;
	/** Each target's unshipped commit count, read apart from the targets. */
	shipUnshipped: Handler;
	/** Each target's current version, read apart from the targets. */
	shipCurrent: Handler;
	/** The versions each target may ship, read apart from the targets. */
	shipVersions: Handler;
	/** Composes picked targets of the `ships` commands into one plan. */
	shipPlan: Handler;
	/** Every ship run, or, posted from the page, a new one started. */
	shipRuns: Handler;
	/** One ship run. */
	shipRun: Handler;
	/** One ship run as it goes, as server-sent events. */
	shipRunEvents: Handler;
	/** Every prompt a ship run's step has open. */
	shipWaiting: Handler;
	/** Answers a prompt a ship run's step waits on. */
	shipRunAnswer: Handler;
	/** Sends a ship run's failed step round again. */
	shipRunRetry: Handler;
	/** Stops a ship run, for the user only. */
	shipRunStop: Handler;
	shipRunTargetStop: Handler;
	/** Sends a ship run's failed step to an agent, as a board task. */
	shipRunSend: Handler;
	shipRunSendTarget: Handler;
	/** Adds a board task for an agent and starts one on it, answering its number. */
	sendToAgent: (subject: string, text: string) => Promise<number>;
	shipRunSupervise: Handler;
	shipRunAutoApprove: Handler;
	/** Sends a failed step round again for the started task fixing it. */
	shipRunFixRetry: Handler;
	/** Adds an agent's note to a ship run. */
	shipRunNote: Handler;
	listCreds: Handler;
	saveCred: Handler;
	removeCred: Handler;
	dismissCred: Handler;
	/** Where its replica stands now, or as last recorded; null when none has run. */
	replica: () => Promise<ReplicaStatus | null>;
	/** Whether its creds, the project's then the device's, keep `name`. */
	kept: (name: string) => Promise<boolean>;
	listBudgets: Handler;
	setBudget: Handler;
	raiseBudget: Handler;
	endRaise: Handler;
	pauseBudget: Handler;
	resumeBudget: Handler;
	listAutomations: Handler;
	addAutomation: Handler;
	editAutomation: Handler;
	removeAutomation: Handler;
	pauseAutomation: Handler;
	resumeAutomation: Handler;
	runAutomation: Handler;
	listConversations: Handler;
	searchConversations: Handler;
	showConversation: Handler;
	refreshLimits: Handler;
	chooseDefault: Handler;
	startShipTask(task: string, ship: string): Promise<void>;
	startConversation: Handler;
	startAutopick: Handler;
	tryAutopick: Handler;
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
	restartConversation: Handler;
	handOffConversation: Handler;
	stopBackground: Handler;
	cancelEval: Handler;
	backgroundOutput: Handler;
	unqueueConversation: Handler;
	sendQueuedNow: Handler;
	chooseSetting: Handler;
	switchAutopick: Handler;
	renameConversation: Handler;
	markUnread: Handler;
	markRead: Handler;
	visitConversation: Handler;
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
