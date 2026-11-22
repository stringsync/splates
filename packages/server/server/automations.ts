import type { Resource } from "core/disposable";
import {
	type Conversation,
	type Conversations,
	SERVER_TOLD,
} from "../conversations";
import {
	type Automation,
	AutomationRoutes,
	type ClockShelf,
	type FireDeps,
	type Fired,
	fire,
	fireTaskEvent,
	fromHooks,
	GROOMER_AUTOMATION,
	type Hook,
	HookStore,
	migrateSchedules,
	RunStore,
	Scheduler,
	TASK_EVENTS,
	type TaskEvent,
	type TaskEventDeps,
	type TaskEventName,
	TaskSignals,
} from "../hooks";
import { type AgentPick, pickSettings } from "../models";
import {
	eventReference,
	need,
	scheduleReference,
	signalReference,
} from "../plans";
import type { Journal } from "../records";
import { dotted } from "../signals";
import { Groomer } from "./groomer";
import type { Project } from "./project";

/**
 * One project's automations as `splates server` runs them: each on a task
 * event as the journal takes it, and each on a schedule as it comes due,
 * with the routes the Subscriptions tab reads and changes them through.
 */
export class Automations implements Resource {
	readonly routes: AutomationRoutes;
	readonly #project: Project;
	readonly #raise:
		| ((name: string, payload: unknown) => Promise<void>)
		| undefined;
	readonly #clocks: (() => ClockShelf | undefined) | undefined;
	readonly #slug: () => Promise<string>;
	readonly #store: HookStore;
	readonly #runs: RunStore;
	#signals: TaskSignals | null = null;
	#scheduler: Scheduler | null = null;
	#groomer: Groomer | null = null;
	#signalDeps: FireDeps | null = null;
	#taskDeps: TaskEventDeps | null = null;
	#watching: Resource | null = null;

	constructor(
		project: Project,
		/** The project's slug, the prefix of its signals. */
		slug: () => Promise<string>,
		/** Raises `<project>.<name>` as a signal with `payload`. */
		raise?: (name: string, payload: unknown) => Promise<void>,
		/** Where clock schedules are kept, which saved every and cron automations move onto at start. */
		clocks?: () => ClockShelf | undefined,
	) {
		this.#raise = raise;
		this.#clocks = clocks;
		this.#slug = slug;
		this.#project = project;
		this.#store = new HookStore(
			project.storage,
			() => project.config.signals ?? {},
		);
		this.#runs = new RunStore(project.storage);
		this.routes = new AutomationRoutes(
			this.#store,
			this.#runs,
			this.all,
			() => void this.groomed(),
			() => this.#scheduler?.look() ?? Promise.resolve(),
		);
	}

	/** Every automation: the person's, and the shell hooks the project checks in run after them. */
	readonly all = async (): Promise<Automation[]> => [
		...(await this.#store.read()),
		...fromHooks(
			Object.fromEntries(
				Object.entries(this.#project.config.on).map(([event, command]) => [
					event as TaskEventName,
					[{ kind: "run", command } satisfies Hook],
				]),
			),
			"config",
		),
	];

	/**
	 * Fires each automation of the person's, not paused, on signal `name`,
	 * once, with who raised it and the payload.
	 */
	async signalRaised(
		name: string,
		by: string,
		payload: unknown,
	): Promise<number> {
		const deps = this.#signalDeps;
		if (deps === null) {
			return 0;
		}
		const event = await this.#taskEventOf(name, by, payload);
		if (event !== null && this.#taskDeps !== null) {
			await fireTaskEvent(event, await this.all(), this.#taskDeps);
		}
		const matching = await this.#onSignal(name);
		for (const automation of matching) {
			await fire(automation, { signal: name, by, payload }, deps);
			// A one-time clock fires once: its subscription is then over.
			if (isOneTimeClock(name) && automation.source === undefined) {
				await this.#store
					.finish(automation.id, new Date().toISOString())
					.catch((error: unknown) => this.#project.log.error(String(error)));
			}
		}
		return matching.length;
	}

	/**
	 * The task event signal `name` is, when splates raised it for this
	 * project, as `Automations` raises each one; null for any other signal.
	 */
	async #taskEventOf(
		name: string,
		by: string,
		payload: unknown,
	): Promise<TaskEvent | null> {
		const slug = await this.#slug();
		const event = TASK_EVENTS.find(
			(each) => name === dotted(`${slug}/${each}`),
		);
		if (by !== "splates" || event === undefined) {
			return null;
		}
		const { numbers, task } = (payload ?? {}) as Partial<TaskEvent>;
		return {
			name: event,
			from: "",
			at: new Date().toISOString(),
			numbers: Array.isArray(numbers) ? numbers : [],
			task: typeof task === "string" ? task : null,
		};
	}

	/**
	 * Pauses the automations set on signal `name`, with a notice of `why`,
	 * when the signal is removed; one already finished stays finished.
	 */
	async expireSignal(name: string, why = "signal expired"): Promise<void> {
		for (const automation of await this.#store.read()) {
			if (
				"signal" in automation.trigger &&
				automation.trigger.signal === name &&
				automation.finishedAt === undefined
			) {
				await this.#store.pause(automation.id, true, `Source removed: ${why}`);
			}
		}
	}

	/**
	 * Pauses, with a notice, each automation on a call of a signal function
	 * that is not in `known`, as when the project stops declaring it; one
	 * already paused or finished is left alone.
	 */
	async retireFamilies(known: Record<string, unknown>): Promise<void> {
		for (const automation of await this.#store.read()) {
			if (
				automation.family !== undefined &&
				!(automation.family in known) &&
				automation.paused !== true &&
				automation.finishedAt === undefined
			) {
				await this.#store.pause(
					automation.id,
					true,
					"Source removed: this family is no longer declared",
				);
			}
		}
	}

	/** How many automations, not paused, are set on signal `name`. */
	async on(name: string): Promise<number> {
		return (await this.#onSignal(name)).length;
	}

	/** Every automation set on a signal, paused or not. */
	async onSignals(): Promise<
		{
			id: string;
			name: string | null;
			signal: string;
			paused: boolean;
			finished: boolean;
		}[]
	> {
		const found = [];
		for (const { id, name, trigger, paused, finishedAt } of await this.all()) {
			if ("signal" in trigger) {
				found.push({
					id,
					name: name ?? null,
					signal: trigger.signal,
					paused: paused === true,
					finished: finishedAt !== undefined,
				});
			}
		}
		return found;
	}

	async #onSignal(name: string) {
		return (await this.all()).filter(
			({ trigger, paused, finishedAt }) =>
				paused !== true &&
				finishedAt === undefined &&
				"signal" in trigger &&
				trigger.signal === name,
		);
	}

	/** Starts running them, catching up on what came while the server was down. */
	async start(conversations: Conversations, journal: Journal): Promise<void> {
		const { storage, tasks, service, log } = this.#project;
		this.#groomer = new Groomer({
			tasks: () => tasks.all(),
			conversations,
			root: service.git.root,
			log,
		});
		const fireDeps = this.#fireDeps(conversations);
		this.#signalDeps = fireDeps;
		this.#taskDeps = {
			...fireDeps,
			task: async (id) => {
				const task = (await tasks.stored()).find((each) => each.id === id);
				return task === undefined
					? null
					: { stage: task.stage, lane: task.lane };
			},
		};
		this.#signals = await TaskSignals.follow({
			journal,
			log,
			raise: async (event) => {
				// Task numbers and the started task's name; the same words as the event hooks hear.
				await this.#raise?.(event.name, {
					numbers: event.numbers,
					task: event.task,
				});
			},
		});
		const shelf = this.#clocks?.();
		if (shelf !== undefined) {
			await migrateSchedules(this.#store, this.#runs, shelf).catch(
				(error: unknown) =>
					log.error(`moving schedules to clocks: ${String(error)}`),
			);
		}
		this.#scheduler = await Scheduler.start({
			...fireDeps,
			automations: this.all,
			clock: { now: () => Date.now() },
		});
		// Turned on or off, or asked to run, from the command line, as `splates hook groomer`.
		try {
			const watching = storage.watch("");
			watching.events.on("changed", (changed) => {
				if (changed.endsWith("hooks.json")) {
					void this.groomed();
					// One asked to run now, as `splates hook run`.
					void this.#scheduler?.look();
				}
			});
			this.#watching = watching;
		} catch (error) {
			log.error(
				`splates server cannot watch the project's records, so the groomer turns on or off from the command line only as it starts: ${String(error)}`,
			);
		}
		// Hooks run at least once, and none while the server was down: the
		// backlog as it stands is what the groomer grooms.
		void this.groomed();
	}

	/**
	 * Wakes the groomer as its automation now stands: on, it grooms the
	 * backlog; paused, it puts its run away, keeping its row; off, it retires
	 * its conversation.
	 */
	async groomed(): Promise<void> {
		const groomer = (await this.all()).find(
			({ id }) => id === GROOMER_AUTOMATION,
		);
		await this.#groomer?.wake(
			groomer === undefined || groomer.hook.kind !== "groom"
				? null
				: groomer.paused === true
					? "paused"
					: pickOf(groomer.hook),
		);
	}

	/**
	 * Puts a persistent run away resting once no turn of it runs, unless it
	 * waits on you, so the newest holds its role's row until the next run.
	 */
	async #restAfterTurn(
		conversations: Conversations,
		conversation: Conversation,
	): Promise<void> {
		const done = (): boolean =>
			conversation.state.status !== "running" &&
			conversation.state.status !== "starting" &&
			!conversation.state.messages.some((message) => message.queued);
		if (!done()) {
			await new Promise<void>((resolve) => {
				const off = conversations.events.on("changed", (id) => {
					if (id === conversation.id && done()) {
						off();
						resolve();
					}
				});
			});
		}
		if (need(null, conversation.state).kind !== "waiting") {
			await conversation.archive(undefined, { rest: true });
		}
	}

	dispose(): void {
		this.#watching?.dispose();
		this.#signals?.dispose();
		this.#scheduler?.dispose();
		this.#groomer?.dispose();
	}

	/** How a hook runs here: a shell command in the main tree, or an agent started there. */
	#fireDeps(conversations: Conversations): FireDeps {
		const { ps, service, log } = this.#project;
		const root = service.git.root;
		const begin = async (
			pick: AgentPick,
			prompt: string,
			{ persistent, automation }: { persistent?: string; automation?: string },
		): Promise<void> => {
			const offered = (await conversations.settings())[pick.agent] ?? [];
			const conversation = await conversations.start(pick.agent, {
				task: null,
				cwd: root,
				model: pick.model,
				settings: pickSettings(pick.effort, offered),
				assigned: true,
				automatic: true,
				...(persistent === undefined ? {} : { persistent }),
				...(automation === undefined ? {} : { automation }),
			});
			void conversation
				.prompt(prompt, [], undefined, { told: SERVER_TOLD })
				.then(() =>
					persistent === undefined
						? undefined
						: this.#restAfterTurn(conversations, conversation),
				)
				.catch((error: unknown) =>
					log.error(`a hook's agent could not start: ${String(error)}`),
				);
		};
		return {
			runs: this.#runs,
			now: () => new Date().toISOString(),
			log,
			actions: {
				run: async (command, fired) => {
					const { exitCode, stderr } = await ps.spawnCapture(
						["sh", "-c", command],
						{
							cwd: root,
							env: envOf(fired),
							...("signal" in fired
								? { stdin: JSON.stringify(fired.payload ?? null) }
								: {}),
						},
					);
					if (exitCode !== 0) {
						throw new Error(
							stderr.trim() || `\`${command}\` exited ${exitCode}`,
						);
					}
				},
				agent: (hook, fired, id) =>
					begin(hook, `${referenceOf(fired)}\n\n${hook.prompt}`, {
						automation: id,
					}),
				// Not awaited: the groomer works down the backlog turn by turn,
				// while the hooks after it run.
				groom: async (hook) => {
					void this.#groomer?.wake(pickOf(hook));
				},
			},
		};
	}
}

/** What a shell hook is told of what set it off. */
function envOf(fired: Fired): Record<string, string> {
	if ("signal" in fired) {
		return {
			SPLATES_EVENT: "signal",
			SPLATES_SIGNAL: fired.signal,
			SPLATES_PAYLOAD: JSON.stringify(fired.payload ?? null),
			SPLATES_TASKS: "",
			SPLATES_TASK: "",
		};
	}
	if (!("event" in fired)) {
		return { SPLATES_EVENT: "schedule", SPLATES_TASKS: "", SPLATES_TASK: "" };
	}
	return {
		SPLATES_EVENT: fired.event.name,
		SPLATES_TASKS: fired.event.numbers.join(","),
		SPLATES_TASK: fired.event.task ?? "",
	};
}

/** The directive an agent hook's conversation opens with. */
function referenceOf(fired: Fired): string {
	return "signal" in fired
		? signalReference(fired.signal, fired.by, fired.payload)
		: "event" in fired
			? eventReference(fired.event.name, fired.event.numbers, fired.event.task)
			: scheduleReference(fired.schedule);
}

/** The agent, model and thinking level a groom hook runs its groomer as. */
function pickOf({ agent, model, effort }: AgentPick): AgentPick {
	return {
		agent,
		...(model === undefined ? {} : { model }),
		...(effort === undefined ? {} : { effort }),
	};
}

/** Whether `signal` is a one-time clock, `clock.in(...)` or `clock.at(...)`, which fires once. */
function isOneTimeClock(signal: string): boolean {
	return /^(?:[^/]+\/)?clock\.(?:in|at)\(/.test(signal);
}
