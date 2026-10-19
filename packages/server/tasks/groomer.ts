import { Disposer, type Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import { Duration, SystemTimer, type Timer } from "webappwiz/time";
import type { TodoState } from "../board";
import type { Agent, Conversation, Conversations } from "../conversations";
import { grooms, SERVER_TOLD } from "../conversations";
import { type AgentPick, modelsOf } from "../models";
import { groomReference } from "../plans";
import type { SeenGroomed } from "./seen-groomed";

/**
 * How often the todos are checked again for one added with no change seen,
 * as from another tree.
 */
export const GROOM_SWEEP = Duration.mins(5);

/** The lowest tier of model a groomer runs on, so it can judge a todo's. */
const GROOMER_TIER = 2;

/**
 * Hands each todo an agent adds from its task to one groomer for the
 * project, so the adding agent only says what it found and moves on: the
 * groomer checks that no other todo asks it, places it in a lane or leaves
 * it untriaged, links what blocks it, and names the agent and model to
 * work it, as `[SPLATES GROOM #N]` asks.
 *
 * One groomer at a time, so two never place todos against each other: the
 * conversation that opened on `[SPLATES GROOM ...]` and is still on the
 * list is told of each, queued behind its turn while it runs, and one is
 * started in the main tree when there is none. A todo the person added, or
 * that came placed or taken, is theirs and is left be. Each todo is
 * seen once, past a restart; on the first run, every todo on the list is
 * taken as seen, so the backlog is not groomed.
 *
 * Checked as the todos change, as `splates server` sees them, and every
 * `GROOM_SWEEP`.
 */
export class Groomer implements Resource {
	readonly #disposer = new Disposer();
	/** One check at a time, so no todo is handed over twice. */
	#checking = Promise.resolve();
	/** The groomer this run started, until its first words are on its record. */
	#started: Conversation | null = null;

	private constructor(
		private readonly deps: {
			todos: () => Promise<TodoState[]>;
			conversations: Conversations;
			root: string;
			seen: SeenGroomed;
			log: Logger;
		},
		timer: Timer,
	) {
		this.#disposer.use(timer.setInterval(() => this.sweep(), GROOM_SWEEP));
	}

	/** Grooms each todo added from now on, checking the todos at once. */
	static watch({
		timer = new SystemTimer(),
		...deps
	}: {
		/** Every todo on the list. */
		todos: () => Promise<TodoState[]>;
		/** The project's conversations, where its groomer is. */
		conversations: Conversations;
		/** The main tree, where a groomer starts. */
		root: string;
		/** The last todo seen, kept past a restart. */
		seen: SeenGroomed;
		log: Logger;
		timer?: Timer;
	}): Groomer {
		const groomer = new Groomer(deps, timer);
		groomer.sweep();
		return groomer;
	}

	/** Hands the groomer every todo added since the last check. */
	sweep(): Promise<void> {
		const next = this.#checking.then(() => this.#check());
		this.#checking = next.catch((error: unknown) =>
			this.deps.log.error(`could not groom the todos: ${String(error)}`),
		);
		return this.#checking;
	}

	async #check(): Promise<void> {
		const todos = await this.deps.todos();
		const last = Math.max(0, ...todos.map((todo) => todo.id));
		const through = await this.deps.seen.read();
		if (through === null) {
			await this.deps.seen.write(last);
			return;
		}
		const added = todos
			.filter((todo) => todo.id > through && groomable(todo))
			.sort((left, right) => left.id - right.id);
		for (const todo of added) {
			await this.#groom(todo.id);
			this.deps.log.info(`the groomer took todo ${todo.id}`);
		}
		if (last > through) {
			await this.deps.seen.write(last);
		}
	}

	/** Tells the project's groomer of todo `id`, starting one when there is none. */
	async #groom(id: number): Promise<void> {
		const text = groomReference(id);
		const live = (await this.deps.conversations.list()).find(
			({ state }) => !state.archived && grooms(state),
		);
		const started =
			this.#started !== null && !this.#started.state.archived
				? this.#started
				: null;
		const groomer = live ?? started;
		if (groomer !== undefined && groomer !== null) {
			await groomer.prompt(text, [], undefined, { told: SERVER_TOLD });
			return;
		}
		const { conversations, root } = this.deps;
		const pick = groomerPick(conversations.agents);
		const conversation = await conversations.start(pick.agent, {
			task: null,
			cwd: root,
			model: pick.model,
			assigned: true,
		});
		this.#started = conversation;
		// Its agent takes its time to start, so the next check does not wait
		// on it: what it is told meanwhile queues behind this.
		void conversation
			.prompt(text, [], undefined, { told: SERVER_TOLD })
			.catch((error: unknown) =>
				this.deps.log.error(
					`the groomer could not take todo ${id}: ${String(error)}`,
				),
			);
	}

	dispose(): void {
		this.#disposer.dispose();
	}
}

/**
 * Whether `todo` is one for the groomer: added by an agent from its task,
 * and still in no lane and taken by no task, which would each be a call
 * already made. One that names its agent still wants placing.
 */
export function groomable(todo: TodoState): boolean {
	return (
		todo.from !== null &&
		todo.origin === undefined &&
		todo.lane === null &&
		todo.takenBy === null
	);
}

/**
 * What a groomer runs as: the first of `agents`, on its cheapest model of
 * tier `GROOMER_TIER` or more, or on its own when it lists none.
 */
export function groomerPick(agents: readonly Agent[]): AgentPick {
	const [first] = agents;
	if (first === undefined) {
		throw new Error("no agent to groom the todos with");
	}
	const [model] = modelsOf(first)
		.filter((each) => (each.tier ?? GROOMER_TIER) >= GROOMER_TIER)
		.sort(
			(left, right) =>
				(left.costRank ?? Number.POSITIVE_INFINITY) -
				(right.costRank ?? Number.POSITIVE_INFINITY),
		);
	return model === undefined
		? { agent: first.id }
		: { agent: first.id, model: model.id };
}
