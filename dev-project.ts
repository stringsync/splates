import type { AsyncResource, Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { Debouncer, SystemTimer } from "webappwiz/time";
import type { ConversationState, Conversations } from "./conversations";
import { BudgetRoutes } from "./dev-budgets";
import { ConversationRoutes } from "./dev-conversation-routes";
import { CredRoutes } from "./dev-creds";
import { ProjectWatch, SETTLE } from "./dev-project-watch";
import { TaskRoutes } from "./dev-tasks";
import { TodoRoutes } from "./dev-todos";
import { startDispatched } from "./dispatched";
import type { Format } from "./format";
import { HandedOut } from "./handed-out";
import { needs } from "./needs";
import type { Behind, Release } from "./release";
import type { Repository } from "./repository";
import type { Details } from "./show";
import type { Slot } from "./slots";
import { tasksOf } from "./snapshot";

/**
 * Everything one project's page talks to: its records, its stream of
 * changes and its conversations, kept from the first request for it until
 * the server stops.
 */
export async function serveProject(
	project: Project,
	context: DevContext,
): Promise<Served> {
	const { service, format, arborDir, fs, log } = project;
	const watch = await ProjectWatch.start(project, context);
	const conversations = context.conversationsFor(project);
	// A task `arbor add --agent` handed to an agent starts it, whether or
	// not a page listens, so its records are watched all along. One run at
	// a time, so none starts a task the run before it is starting.
	let handOffs: Resource | null = null;
	let handedOut: Resource | null = null;
	if (conversations !== null) {
		handedOut = HandedOut.watch({ service, conversations, log });
		conversations.url = context.url;
		let starting = Promise.resolve();
		const handOff = (): void => {
			starting = starting
				.then(() => startDispatched({ service, conversations, log }))
				.catch((error: unknown) => log.error(String(error)));
		};
		const settled = new Debouncer(new SystemTimer(), SETTLE);
		try {
			const watching = fs.watch(`${arborDir}/tasks`, () =>
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
				`arbor dev cannot watch ${service.git.root}'s tasks, so it starts a task handed to an agent only as it starts: ${String(error)}`,
			);
		}
		handOff();
	}

	const talks = new ConversationRoutes(project, conversations);
	return {
		...new TaskRoutes(project, conversations, watch),
		...new TodoRoutes(project, talks, watch),
		...new CredRoutes(project, watch),
		...new BudgetRoutes(project),
		...talks,
		root: service.git.root,
		format,
		conversations,
		refresh: watch.changed,
		snapshot: async () => Response.json(await watch.read()),
		waiting: async () =>
			waitingOn(
				await tasksOf({ service, fs }),
				((await conversations?.list()) ?? []).map(({ state }) => state),
			),
		events: async () => watch.events(),
		async disposeAsync() {
			watch.dispose();
			handOffs?.dispose();
			handedOut?.dispose();
			await talks.disposeAsync();
		},
	};
}

/** What `dev` serves a project with: its own records, read and written. */
export type Project = Pick<
	Repository,
	"service" | "journal" | "todos" | "format" | "arborDir" | "git" | "creds"
> & { fs: Fs; ps: Ps; log: Logger };

/** What the server as a whole tells each project it serves. */
export interface DevContext {
	/** Where the agents' own `arbor` reaches this server, once it listens. */
	readonly url: string | null;
	/** A newer arbor on npm, once a check has found one; every page says so. */
	readonly release: Release | null;
	/** Commits to arbor's own source since this run started, once seen. */
	readonly behind: Behind | null;
	/** Whether building the page failed, so it serves the one built before. */
	readonly unbuilt: boolean;
	/** The slot `arbor dev --slot` serves under, or null. */
	readonly slot: Slot | null;
	/** The conversations `project`'s page may hold, or null when they are off. */
	conversationsFor(project: Project): Conversations | null;
}

/** A route's work once its project is known. */
export type Handler = (request: Request) => Promise<Response>;

/** One project as the server holds it: what each of its routes does. */
export interface Served extends AsyncResource {
	root: string;
	format: Format;
	conversations: Conversations | null;
	/** Reads the repo again soon, telling its pages if anything moved. */
	refresh: () => void;
	snapshot: Handler;
	/** How many of its agents wait on the person. */
	waiting: () => Promise<number>;
	events: Handler;
	file: Handler;
	paths: Handler;
	systems: Handler;
	systemChanges: Handler;
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
	listCreds: Handler;
	saveCred: Handler;
	removeCred: Handler;
	dismissCred: Handler;
	listBudgets: Handler;
	setBudget: Handler;
	raiseBudget: Handler;
	endRaise: Handler;
	listConversations: Handler;
	refreshLimits: Handler;
	startConversation: Handler;
	listSessions: Handler;
	bringSession: Handler;
	/**
	 * Asks every live conversation here to bring its ARBOR.md up to date,
	 * answering with what settles as each answers.
	 */
	checkpoint: (only?: string[]) => Promise<Promise<void>[]>;
	moveConversation: Handler;
	promptConversation: Handler;
	tellConversation: Handler;
	terminateConversation: Handler;
	conversationAttachment: Handler;
	answerConversation: Handler;
	cancelConversation: Handler;
	stopBackground: Handler;
	backgroundOutput: Handler;
	unqueueConversation: Handler;
	sendQueuedNow: Handler;
	chooseSetting: Handler;
	renameConversation: Handler;
	markUnread: Handler;
	archiveConversation: Handler;
	conversationEvents: Handler;
	terminalTree: (request: Request) => Promise<string>;
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
