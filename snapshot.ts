import { basename } from "node:path";
import type { Fs } from "webappwiz/system";
import { type Details, TaskDetails } from "./show";
import type { TodoState, Todos } from "./todo";
import type { WorktreeService } from "./worktree-service";

/**
 * Everything one page shows: `todo list`, and `list` and `show` for each
 * task.
 */
export interface Snapshot {
	/** The repository's directory name, so a page among many says whose it is. */
	repo: string;
	/** Past this age a todo is offered for removal rather than recommended. */
	todoStalenessMs: number;
	todos: TodoState[];
	tasks: Details[];
}

/**
 * Reads the whole repo the way the CLI's read commands do. Takes no lease, so
 * the page can sit open on a live tree without disturbing the agent in it.
 */
export async function snapshot({
	service,
	todos,
	fs,
}: {
	service: WorktreeService;
	todos: Todos;
	fs: Fs;
}): Promise<Snapshot> {
	const details = new TaskDetails({ fs });
	const tasks: Details[] = [];
	for (const worktree of await service.list()) {
		tasks.push(await details.get(worktree));
	}
	return {
		repo: basename(service.git.root),
		todoStalenessMs: service.config.todoStalenessMs,
		todos: (await todos.all()).map((todo) => todo.state),
		tasks,
	};
}

/**
 * What the page is actually showing, minus the fields that move on their own.
 * `age` ticks every minute, and hashing it would push to every open page for
 * nothing.
 */
export function fingerprint({ todos, tasks }: Snapshot): string {
	return JSON.stringify([
		todos,
		tasks.map((task) => [
			task.task,
			task.status,
			task.lease,
			task.ahead,
			task.added,
			task.removed,
			task.escalation,
			task.review,
			task.plan,
			task.planProblems,
		]),
	]);
}
