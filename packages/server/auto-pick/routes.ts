import type { Conversations } from "../conversations";
import { treeOf } from "../conversations";
import { fail } from "../exit";
import type { Project, ProjectWatch } from "../server/shared";
import { body } from "../server/shared";
import {
	type AutoPickTarget,
	type AutoPickWords,
	startAutoPick,
} from "./start";
import { tryAutoPick } from "./trial";

/**
 * How a project's page starts a task on what Auto pick decides, or sees what
 * it would decide. Each handler is a property, so `serveProject` spreads them
 * into the project's routes, as it does `ConversationRoutes`'.
 */
export class AutoPickRoutes {
	readonly #project: Project;
	readonly #conversations: Conversations | null;
	readonly #watch: ProjectWatch;

	constructor(
		project: Project,
		conversations: Conversations | null,
		watch: ProjectWatch,
	) {
		this.#project = project;
		this.#conversations = conversations;
		this.#watch = watch;
	}

	/**
	 * Starts a conversation on what Auto pick decides for `task`, a started
	 * task by name, in its tree, or `todo`, a queued one by number, in the
	 * main tree, or `words`, a new conversation's first message, in `task`'s
	 * tree if one is named. It answers before the judge does, as any start answers
	 * before its agent opens, and the prompt the page sends next waits on the
	 * pick.
	 */
	readonly startAutoPick = async (request: Request): Promise<Response> => {
		const conversations = this.#conversations;
		if (conversations === null) {
			fail("not_found", "conversations are off", {});
		}
		const { task, todo, words } = await body(request);
		// A new conversation's first message, judged in `task`'s tree, if named.
		const target: AutoPickWords =
			typeof words === "string" ? { words } : targetOf(task, todo);
		const [named, cwd, base, caller] = await treeOf(
			this.#project.service,
			"words" in target ? task : "task" in target ? target.task : null,
		);
		const conversation = await startAutoPick({
			project: this.#project,
			conversations,
			target,
			// Not the person's pick, so the next start does not take its settings.
			start: (agent, { model, settings, picking }) =>
				conversations.start(agent, {
					task: named,
					base,
					caller,
					cwd,
					model,
					settings,
					assigned: true,
					picking: picking.finally(() => this.#watch.changed()),
				}),
		});
		return Response.json(conversation.state);
	};

	/**
	 * What Auto pick would decide for `task` or `todo`, named as for
	 * `startAutoPick`, without starting it or writing its record: Setup's
	 * "Try it on a task".
	 */
	readonly tryAutoPick = async (request: Request): Promise<Response> => {
		const conversations = this.#conversations;
		if (conversations === null) {
			fail("not_found", "conversations are off", {});
		}
		const { task, todo } = await body(request);
		return Response.json(
			await tryAutoPick({
				project: this.#project,
				conversations,
				target: targetOf(task, todo),
			}),
		);
	};
}

/** What the page's body names: a started task's name, or a queued one's number. */
function targetOf(task: unknown, todo: unknown): AutoPickTarget {
	if (typeof task === "string" && task !== "") {
		return { task };
	}
	if (typeof todo === "number" && Number.isInteger(todo) && todo > 0) {
		return { todo };
	}
	fail("usage", "name a task, by `task` or by `todo` number, to Auto pick", {});
}
