import { basename } from "node:path";
import type { Fs } from "webappwiz/system";
import { type Inbox, openQuestions } from "./inbox";
import type { Entry, Journal } from "./journal";
import { DEFAULT_COUNT } from "./log";
import { type Details, TaskDetails } from "./show";
import type { TodoState, Todos } from "./todo";
import type { WorktreeService } from "./worktree-service";

/**
 * Everything one page shows: `inbox`, `todo list`, `list` and `show` for each
 * task, and `log`.
 */
export interface Snapshot {
	/** The repository's directory name, so a page among many says whose it is. */
	repo: string;
	/** Past this age a todo is offered for removal rather than recommended. */
	todoStalenessMs: number;
	inbox: Inbox;
	todos: TodoState[];
	tasks: Details[];
	entries: Entry[];
}

/**
 * Reads the whole repo the way the CLI's read commands do. Takes no lease, so
 * serving a page cannot knock an agent off the tree it is driving.
 */
export async function snapshot({
	service,
	journal,
	todos,
	fs,
}: {
	service: WorktreeService;
	journal: Journal;
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
		// Replied ones too: the page hides them itself, behind a toggle.
		inbox: await openQuestions({ service, fs }, { replied: true }),
		todos: (await todos.all()).map((todo) => todo.state),
		tasks,
		entries: await journal.tail(DEFAULT_COUNT),
	};
}

/**
 * What the page is actually showing, minus the fields that move on their own.
 * `age` ticks every minute, and hashing it would push to every open page for
 * nothing.
 */
export function fingerprint({
	inbox,
	todos,
	tasks,
	entries,
}: Snapshot): string {
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
			task.plan,
			task.planProblems,
		]),
		entries.length,
		entries.at(-1)?.at ?? null,
	]);
}
