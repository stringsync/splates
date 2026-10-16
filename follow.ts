import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import type { Git } from "./git";
import type { Projects } from "./projects";

/** What `fetch` is used for here, so a test can stand in for it. */
type Send = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Tells `arbor dev` that the agent in a conversation took or left a task, so
 * the conversation follows it into that worktree, or back to the main tree.
 * An agent started from the page runs with its conversation and the server
 * in its env; any other `arbor` has neither, and says nothing. A server that
 * cannot be reached is worth a line, never a failure: the task command has
 * done its work.
 */
export async function follow(
	{ ps, log, send = fetch }: { ps: Ps; log: Logger; send?: Send },
	task: string | null,
	{
		from,
		base,
	}: {
		/** The task being left; given, the conversation moves only out of it. */
		from?: string;
		/**
		 * The branch `task` lands on, for an add to send before the task's
		 * record names it, so the server can tell a part from a task to follow.
		 */
		base?: string;
	} = {},
): Promise<void> {
	const id = ps.env("ARBOR_CONVERSATION");
	const url = ps.env("ARBOR_DEV");
	if (id === undefined || url === undefined) {
		return;
	}
	try {
		const response = await send(`${url}/api/conversations/${id}/task`, {
			method: "PUT",
			// The server refuses a write from any other origin than its own.
			headers: { "content-type": "application/json", origin: url },
			body: JSON.stringify({ task, from, base }),
		});
		if (!response.ok) {
			log.error(`arbor dev did not move the conversation: ${response.status}`);
		}
	} catch (error) {
		log.error(
			`arbor dev at ${url} could not be told of the move: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Asks `arbor dev` to serve the project `git` is in, so the agent a task
 * there was just handed to from another project starts: the server opens a
 * project only once something asks for it. Outside `arbor dev` it says
 * nothing; a server that cannot be reached is worth a line.
 */
export async function serveProject({
	ps,
	log,
	git,
	projects,
	send = fetch,
}: {
	ps: Ps;
	log: Logger;
	git: Git;
	projects: Projects;
	send?: Send;
}): Promise<void> {
	const url = ps.env("ARBOR_DEV");
	const slug = (await projects.list()).find(
		(each) => each.root === git.root,
	)?.slug;
	if (url === undefined || slug === undefined) {
		return;
	}
	try {
		const response = await send(`${url}/api/projects/${slug}/serve`, {
			method: "POST",
			headers: { origin: url },
		});
		if (!response.ok) {
			log.error(`arbor dev did not serve ${slug}: ${response.status}`);
		}
	} catch (error) {
		log.error(
			`arbor dev at ${url} could not be asked to serve ${slug}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
