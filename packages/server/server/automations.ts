import type { Resource } from "webappwiz/disposable";
import {
	type Conversation,
	type Conversations,
	SERVER_TOLD,
} from "../conversations";
import {
	type Automation,
	AutomationRoutes,
	type FireDeps,
	type Fired,
	fromHooks,
	GROOMER_AUTOMATION,
	type Hook,
	HookRunner,
	HookStore,
	RunStore,
	Scheduler,
	type TaskEventName,
} from "../hooks";
import { type AgentPick, pickSettings } from "../models";
import { eventReference, need, scheduleReference } from "../plans";
import type { Journal } from "../records";
import { Groomer } from "./groomer";
import type { Project } from "./project";

/**
 * One project's automations as `splates server` runs them: each on a task
 * event as the journal takes it, and each on a schedule as it comes due,
 * with the routes the Automations page reads and changes them through.
 */
export class Automations implements Resource {
	readonly routes: AutomationRoutes;
	readonly #project: Project;
	readonly #store: HookStore;
	readonly #runs: RunStore;
	#runner: HookRunner | null = null;
	#scheduler: Scheduler | null = null;
	#groomer: Groomer | null = null;
	#watching: Resource | null = null;

	constructor(project: Project) {
		this.#project = project;
		this.#store = new HookStore(project.storage);
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
		this.#runner = await HookRunner.follow({
			...fireDeps,
			journal,
			storage,
			automations: this.all,
			task: async (id) => {
				const task = (await tasks.stored()).find((each) => each.id === id);
				return task === undefined
					? null
					: { stage: task.stage, lane: task.lane };
			},
		});
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
		this.#runner?.dispose();
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
						{ cwd: root, env: envOf(fired) },
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
	return "event" in fired
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
