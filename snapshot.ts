import { basename } from "node:path";
import type { Fs } from "webappwiz/system";
import { type Inbox, openQuestions } from "./inbox";
import type { Replies } from "./replies";
import { type Details, TaskDetails } from "./show";
import type { TodoState, Todos } from "./todo";
import type { WorktreeService } from "./worktree-service";

/**
 * Everything one page shows: `list` and `show` for each task, every question
 * each one asked however it stands, and `todo list`.
 */
export interface Snapshot {
	/** The repository's directory name, so a page among many says whose it is. */
	repo: string;
	/** Past this age a todo is offered for removal rather than recommended. */
	todoStalenessMs: number;
	inbox: Inbox;
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
	replies,
	fs,
}: {
	service: WorktreeService;
	todos: Todos;
	replies: Replies;
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
		// Answered and checked off too: each stays under its task to follow up.
		inbox: await openQuestions(
			{ service, fs, replies },
			{ replied: true, done: true },
		),
		todos: (await todos.all()).map((todo) => todo.state),
		tasks,
	};
}

/**
 * What the page is actually showing, minus the fields that move on their own.
 * `age` ticks every minute, and hashing it would push to every open page for
 * nothing.
 */
export function fingerprint({ inbox, todos, tasks }: Snapshot): string {
	return JSON.stringify([
		inbox.questions,
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
