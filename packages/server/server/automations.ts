import type { Resource } from "webappwiz/disposable";
import { type Conversations, SERVER_TOLD } from "../conversations";
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
import { type AgentPick, effortSettings } from "../models";
import { eventReference, scheduleReference } from "../plans";
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
		this.#store = new HookStore(`${project.splatesDir}/hooks.json`, project.fs);
		this.#runs = new RunStore(
			`${project.splatesDir}/hooks-runs.json`,
			project.fs,
		);
		this.routes = new AutomationRoutes(
			this.#store,
			this.#runs,
			this.all,
			() => void this.groomed(),
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
		const { fs, splatesDir, tasks, service, log } = this.#project;
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
			fs,
			splatesDir,
			automations: this.all,
			task: async (id) => {
				const task = (await tasks.stored()).find((each) => each.id === id);
				return task === undefined
					? null
					: { stage: task.stage, lane: task.lane };
			},
			seen: `${splatesDir}/hooks-seen.json`,
		});
		this.#scheduler = await Scheduler.start({
			...fireDeps,
			automations: this.all,
			clock: { now: () => Date.now() },
		});
		// Turned on or off from the command line, as `splates hook groomer`.
		try {
			this.#watching = fs.watch(splatesDir, (changed) => {
				if (changed.endsWith("hooks.json")) {
					void this.groomed();
				}
			});
		} catch (error) {
			log.error(
				`splates server cannot watch ${splatesDir}, so the groomer turns on or off from the command line only as it starts: ${String(error)}`,
			);
		}
		// Hooks run at least once, and none while the server was down: the
		// backlog as it stands is what the groomer grooms.
		void this.groomed();
	}

	/**
	 * Wakes the groomer as its automation now stands: on, it grooms the
	 * backlog; off or paused, it retires its conversation.
	 */
	async groomed(): Promise<void> {
		const groomer = (await this.all()).find(
			({ id }) => id === GROOMER_AUTOMATION,
		);
		await this.#groomer?.wake(
			groomer === undefined ||
				groomer.paused === true ||
				groomer.hook.kind !== "groom"
				? null
				: pickOf(groomer.hook),
		);
	}

	dispose(): void {
		this.#watching?.dispose();
		this.#runner?.dispose();
		this.#scheduler?.dispose();
	}

	/** How a hook runs here: a shell command in the main tree, or an agent started there. */
	#fireDeps(conversations: Conversations): FireDeps {
		const { ps, service, log } = this.#project;
		const root = service.git.root;
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
				agent: async (hook, fired) => {
					const offered = (await conversations.settings())[hook.agent] ?? [];
					const conversation = await conversations.start(hook.agent, {
						task: null,
						cwd: root,
						model: hook.model,
						settings: effortSettings(hook.effort, offered),
						assigned: true,
						capped: true,
					});
					void conversation
						.prompt(`${referenceOf(fired)}\n\n${hook.prompt}`, [], undefined, {
							told: SERVER_TOLD,
						})
						.catch((error: unknown) =>
							log.error(`a hook's agent could not start: ${String(error)}`),
						);
				},
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
