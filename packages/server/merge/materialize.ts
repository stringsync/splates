import type { Config } from "../config";
import type { WorkerMachine } from "../workers";
import type { TaskBranches } from "./branches";

/** The project `materialize` readies on a worker. */
export interface MaterializedProject {
	/** Its slug, which names its mirror and clone on the worker. */
	slug: string;
	config: Pick<Config, "remote" | "trunk">;
	branches: TaskBranches;
}

/**
 * Readies `project` on a remote worker before an agent starts there: its
 * mirror and clone of trunk fetched, or made the first time, signing in
 * with a token minted here and sent over the worker's socket, which the
 * worker holds only while git runs. Answers the clone's path, the agent's
 * working directory, where `splates add` clones each task beside it.
 */
export async function materialize(
	worker: WorkerMachine,
	project: MaterializedProject,
): Promise<string> {
	const { remote, trunk } = project.config;
	const target = await project.branches.signIn(null);
	if (remote === null || target === null) {
		throw new Error(
			`${project.slug} has no central remote (\`remote\` in splates.config.ts), which a remote worker checks it out from`,
		);
	}
	return worker.checkout({
		project: project.slug,
		url: target.url,
		remote,
		trunk,
		env: target.env,
	});
}
