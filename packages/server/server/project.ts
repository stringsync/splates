import type { Resource } from "core/disposable";
import { UuidProvider } from "core/id";
import { Debouncer, SystemTimer, SystemWallClock } from "core/time";
import { AutoPickRoutes, lifting, QueueAutoPick } from "../auto-pick";
import type { TaskRecord } from "../board";
import { BoardRoutes, ElsewhereLinks } from "../board";
import { loadConfig, shipSettings, shipTargets } from "../config";
import {
	ConversationRoutes,
	type ConversationState,
	JournalEvents,
	NoopConversations,
	SERVER_TOLD,
} from "../conversations";
import { CredRoutes } from "../creds";
import { fail } from "../exit";
import { ShipLock, Shipping, ShipRoutes } from "../legacy-ship";
import type { AgentPick } from "../models";
import { needs, taskNumberReference, waitsOnYou } from "../plans";
import { QUEUE_SWEEP, QueueCapacity, QueueRunner } from "../queue";
import { Replicator } from "../replica";
import {
	ShellStepProcesses,
	ShipCommands,
	ShipComposer,
	ShipEngine,
	ShipFixes,
	ShipPlanRoutes,
	ShipRunRoutes,
	waitingIn,
} from "../ship";
import { BudgetRoutes } from "../stats";
import type { Details } from "../tasks";
import { startDispatched, TaskRoutes } from "../tasks";
import { LOCAL_WORKER, Machine, OsSensors } from "../workers";
import { Automations } from "./automations";
import { ConflictWatch } from "./conflict-watch";
import { heldFor } from "./held";
import { MergeRoutes } from "./merges";
import type { DevContext, Project, Served } from "./project-types";
import { ProjectWatch, SETTLE } from "./project-watch";

/**
 * Everything one project's page talks to: its records, its stream of
 * changes and its conversations, kept from the first request for it until
 * the server stops.
 */
export async function serveProject(
	project: Project,
	context: DevContext,
): Promise<Served> {
	const { service, format, storage, log, journal } = project;
	// Durable eval loops are gone; clearing what an older splates left behind
	// changes nothing when there is none, so no records format moves.
	await storage
		.collection("eval-loops")
		.clear()
		.catch((error: unknown) => log.error(String(error)));
	const watch = await ProjectWatch.start(project, context);
	const conversations = context.conversationsFor(project);
	const listed = conversations ?? new NoopConversations();
	const slug = () => context.everywhere.slug(project.service.git.root);
	const conflicts = new ConflictWatch(project, listed);
	await conflicts.start();
	const shippingOptions = {
		storage,
		fs: project.fs,
		ps: project.ps,
		log,
		root: service.git.root,
		dir: project.dir,
		prepare: project.config.postRewrite,
	};
	const shipping = new Shipping({
		...shippingOptions,
		command: shipSettings(project.config, await slug()).ship,
		slug,
	});
	// A repository naming `ships` has a runner for each target, one at a time
	// since each commits to the same trunk; the one above stays for the
	// repository as a whole.
	const lock = new ShipLock();
	const targets = project.config.legacyShips ? shipTargets(project.config) : [];
	const targetShippings = new Map(
		targets.map((target) => [
			target.name,
			new Shipping({
				...shippingOptions,
				command: target.ship,
				slug: async () => target.name,
				target: target.name,
				lock,
			}),
		]),
	);
	// A task `splates add --agent` handed to an agent starts it, whether or
	// not a page listens, so its records are watched all along. One run at
	// a time, so none starts a task the run before it is starting.
	let handOffs: Resource | null = null;
	let queueRunner: QueueRunner | null = null;
	let unwatchRoom: (() => void) | null = null;
	let starting = Promise.resolve();
	const automations = new Automations(project);
	const replicator = context.replicas.of(project);
	let events: Resource | null = null;
	if (conversations !== null) {
		const capacity = new QueueCapacity();
		const machine = new Machine(new OsSensors(project.fs));
		queueRunner = QueueRunner.watch({
			queued: () => project.tasks.stored(),
			settle: async () => {
				// A blocker in another project that merged there lets its task go on.
				if (context.boards !== undefined) {
					await new ElsewhereLinks(project.tasks).settle(context.boards);
				}
			},
			tasks: async () => (await service.list()).map(({ task }) => task),
			picker: new QueueAutoPick(project, conversations, { slug }),
			start: ({ task, queued, pick, prompt, held }) =>
				startQueuedTask(project, context.url, {
					task,
					number: queued.id,
					pick,
					prompt,
					held,
				}),
			resume: async (task) => {
				const id = task.deferred?.conversation;
				const conversation = (await conversations.list()).find(
					(each) => each.state.id === id,
				);
				if (conversation === undefined) {
					return false;
				}
				if (task.deferred?.suspended === true) {
					// The person writing to it already woke it.
					const spoke = conversation.state.messages.some(
						(message) =>
							message.role === "user" &&
							message.told === undefined &&
							(message.at ?? "") > (task.deferred?.at ?? ""),
					);
					await (await project.tasks.find(task.id)).wake();
					if (spoke) {
						return false;
					}
				}
				if (conversation.state.archived) {
					await conversation.unarchive();
				}
				void conversation
					.prompt(taskNumberReference(task.id), [], undefined, {
						told: SERVER_TOLD,
					})
					.catch((error: unknown) =>
						log.error(`could not resume task ${task.id}: ${String(error)}`),
					);
				return true;
			},
			held: heldFor(conversations, service, log),
			paused: () => context.paused(),
			overloaded: async () =>
				capacity.overloaded(project.config.queueLoad, await machine.read()),
			capacity: () => capacity.reading,
			log,
		});
		const queue = queueRunner;
		unwatchRoom = context.onWorkerRoom(() => void queue.sweep());
		events = await JournalEvents.follow({
			journal,
			conversations,
			log,
		});
		await automations.start(conversations, journal);
		conversations.url = context.url;
		conversations.lift = lifting(project, conversations, { slug });
		const startAll = (): void => {
			starting = starting
				.then(() => startDispatched({ service, conversations, log }))
				.catch((error: unknown) => log.error(String(error)));
		};
		const handOff = (): void => {
			// A task gone moves the queue on.
			void queue.sweep();
			startAll();
		};
		const timer = new SystemTimer();
		const settled = new Debouncer(timer, SETTLE);
		// Again with the queue's sweep, for a task handed out while its
		// change went unseen or its start did not take.
		const sweeping = timer.setInterval(startAll, QUEUE_SWEEP);
		handOffs = sweeping;
		try {
			const watching = storage.watch("tasks");
			watching.events.on("changed", () => settled.call(handOff));
			handOffs = {
				dispose: () => {
					sweeping.dispose();
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

	const shipCommands = new ShipCommands(
		// Read from the main tree each time, so a ship command that lands on
		// the base shows without a restart; the start-up list stands when the
		// file cannot be read.
		async () => {
			try {
				return (await loadConfig(service.git.root)).ships ?? [];
			} catch (error) {
				log.error(
					`splates server could not reread ships from ${service.git.root}: ${String(error)}`,
				);
				return project.config.ships ?? [];
			}
		},
		project.ps,
		service.git.root,
	);
	const shipEngine = new ShipEngine({
		storage,
		processes: new ShellStepProcesses(project.ps, service.git.root),
		clock: new SystemWallClock(),
		ids: new UuidProvider(),
		log,
	});
	// A page holds the project's stream already, so a run's changes ride on it.
	const runWatch = shipEngine.listen((id, state) =>
		watch.announce("ship", { id, state }),
	);
	// A ship a restart cut short carries on now, not once the page asks.
	void shipEngine
		.resume()
		.catch((error: unknown) =>
			log.error(`splates server could not resume its ships: ${String(error)}`),
		);

	const shipFixes = new ShipFixes(
		shipEngine,
		{
			add: async (subject, text) =>
				(await project.tasks.add(subject, null, { text })).id,
			start: async (task) => {
				if (conversations === null) {
					throw new Error("conversations are off");
				}
				const response = await new AutoPickRoutes(
					project,
					conversations,
					watch,
					slug,
				).startAutoPick(
					new Request("http://localhost/start", {
						method: "POST",
						body: JSON.stringify({ todo: task }),
					}),
				);
				const { id } = (await response.json()) as { id: string };
				const conversation = (await conversations.list()).find(
					(each) => each.state.id === id,
				);
				if (conversation === undefined) {
					throw new Error(`the conversation for task #${task} was not created`);
				}
				void conversation
					.prompt(
						`${taskNumberReference(task)}\n\nThis task fixes a step of a ship the user started: its words say how to read the run and try the step again. Once the task ends, merged or removed, the ship retries the step by itself.`,
						[],
					)
					.catch((error: unknown) => log.error(String(error)));
			},
			ended: async (task) => {
				if ((await project.tasks.stored()).some((each) => each.id === task)) {
					return null;
				}
				const finished = (await service.finished.list()).find((each) =>
					each.took.some((taken) => taken.id === task),
				);
				return finished?.ended ?? "removed";
			},
			takenBy: async (task) =>
				(await project.tasks.stored()).find((each) => each.id === task)
					?.takenBy ?? null,
		},
		log,
	);
	// A fix that merged while the server was down retries its step now.
	void shipEngine.resume().then(() => shipFixes.settle());
	let fixWatch: Resource | null = null;
	try {
		const watching = storage.watch("tasks");
		watching.events.on("changed", () => void shipFixes.settle());
		fixWatch = watching;
	} catch (error) {
		log.error(
			`splates server cannot watch ${service.git.root}'s tasks, so a ship retries a fixed step only as it starts: ${String(error)}`,
		);
	}

	const talks = new ConversationRoutes(
		project,
		conversations,
		context.everywhere,
	);
	const taskRoutes = new TaskRoutes(project, listed, watch);
	return {
		...taskRoutes,
		...new MergeRoutes(project, undefined, conversations),
		...new BoardRoutes(project, talks, watch, {
			boards: context.boards,
			root: service.git.root,
		}),
		...new CredRoutes(project, watch),
		...new BudgetRoutes(project),
		...automations.routes,
		...new ShipRoutes(shipping, project.fs),
		...new ShipPlanRoutes(shipCommands),
		...new ShipRunRoutes(shipEngine, new ShipComposer(shipCommands), shipFixes),
		shipping,
		targetShipping: (name) => targetShippings.get(name) ?? null,
		afterBumpOf: (_name) => project.config.afterBump,
		startShipTask: async (task: string, ship: string) => {
			if (conversations === null) {
				throw new Error("conversations are off");
			}
			if (
				(await conversations.list()).some(
					(each) => each.state.task === task && !each.state.archived,
				)
			) {
				return;
			}
			const response = await new AutoPickRoutes(
				project,
				conversations,
				watch,
				slug,
			).startAutoPick(
				new Request("http://localhost/start", {
					method: "POST",
					body: JSON.stringify({ task, ship }),
				}),
			);
			const state = (await response.json()) as { id: string };
			const conversation = (await conversations.list()).find(
				(each) => each.state.id === state.id,
			);
			if (conversation === undefined) {
				throw new Error("ship conversation was not created");
			}
			void conversation
				.prompt(
					`[SPLATES TASK ${task}]\n\nThis task belongs to a ship. Follow SPLATES.md; fix what breaks and merge, never bump further.`,
					[],
				)
				.catch((error: unknown) => log.error(String(error)));
		},
		...new AutoPickRoutes(project, conversations, watch, slug),
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
		afterBump: shipSettings(project.config, await slug()).afterBump,
		journal,
		format,
		conversations,
		replica: async () =>
			replicator?.status() ?? (await Replicator.recorded(storage)),
		kept: async (name) =>
			(await project.creds.credentials.get(name)) !== undefined,
		refresh: watch.changed,
		snapshot: async () => Response.json(await watch.current()),
		current: () => watch.current(),
		waiting: async () => {
			const { tasks, todos } = await watch.current();
			return waitingOn(
				tasks,
				((await conversations?.list()) ?? []).map(({ state }) => state),
				todos,
			);
		},
		shipPrompts: async () => (await shipEngine.list()).flatMap(waitingIn),
		needing: async () => {
			const { tasks, todos } = await watch.current();
			return {
				rows: needs({
					tasks,
					todos,
					conversations: ((await conversations?.list()) ?? []).map(
						({ state }) => state,
					),
				}),
				lanes: await project.tasks.laneNames(),
			};
		},
		lanes: () => project.tasks.laneNames(),
		portOwners: async () => ({
			worktrees: (await service.list())
				.filter((each) => each.exists)
				.map(({ task, path }) => ({ task, path, worker: LOCAL_WORKER })),
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
			await conflicts.disposeAsync();
			runWatch.dispose();
			fixWatch?.dispose();
			await shipEngine.disposeAsync();
			shipping.dispose();
			for (const each of targetShippings.values()) {
				each.dispose();
			}
			watch.dispose();
			handOffs?.dispose();
			queueRunner?.dispose();
			unwatchRoom?.();
			automations.dispose();
			events?.dispose();
			// A run mid-start has launched an agent it has yet to record, which a
			// server starting next would launch again.
			await starting;
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

export type {
	DevContext,
	DevMachine,
	Handler,
	Project,
	ProjectHeard,
	Served,
} from "./project-types";

/**
 * How many agents wait on the person, counted as the page's waiting line
 * counts them: only conversations, and questions only while unanswered.
 */
export function waitingOn(
	tasks: Details[],
	conversations: ConversationState[],
	todos?: readonly TaskRecord[],
): number {
	return needs({ tasks, conversations, todos }).filter(waitsOnYou).length;
}

/**
 * How many tasks wait on the person where no conversation is known, as for a
 * project not opened, whose conversations are not loaded.
 */
export function waitingTasks(tasks: Details[]): number {
	return needs({ tasks, conversations: [] }).filter(
		({ need }) => need.kind === "waiting",
	).length;
}
