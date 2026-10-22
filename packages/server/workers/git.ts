import { Git, type GitFiles } from "../git";
import type { Author } from "../git-identity";
import type { WorkerMachine } from "./machine";

/**
 * Git on the worker a checkout is on, rooted at `root`: what `Watch` runs
 * around an agent's commands, and what the server reads a task's
 * branch through when its checkout is a worker's clone. Commits there are
 * signed as the author `identity` names, the server's, when the
 * worker has none.
 */
export function workerGit(
	root: string,
	machine: WorkerMachine,
	identity: Author | null = null,
): Git {
	return new Git(root, {
		run: machine,
		fs: workerFiles(machine),
		...(identity === null ? {} : { identity }),
	});
}

/** The files `Git` reads itself, read on `machine`. */
function workerFiles(machine: WorkerMachine): GitFiles {
	return {
		exists: (path) => machine.exists(path),
		read: async (path) => {
			if (!(await machine.exists(path))) {
				throw new Error(`no file at ${path} on the worker`);
			}
			return new TextDecoder().decode((await machine.read(path, 0)).bytes);
		},
	};
}
