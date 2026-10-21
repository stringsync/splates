import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import type { Git } from "../git";
import type { Projects } from "../projects";
import { serverOf } from "../workers";

/**
 * How long a server is waited on before it counts as unreachable: one that
 * stalled would otherwise hold the task command for fetch's own five minutes.
 */
export const SERVER_WAIT_MS = 30_000;

/** What `fetch` is used for here, so a test can stand in for it. */
type Send = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Tells `splates server` that the agent in a conversation took or left a task, so
 * the conversation follows it into that worktree, or back to the main tree.
 * An agent started from the page runs with its conversation and the server
 * in its env; any other `splates` has neither, and says nothing. A server that
 * cannot be reached is worth a line, never a failure: the task command has
 * done its work.
 */
export async function follow(
	{ ps, fs, log, send }: { ps: Ps; fs?: Fs; log: Logger; send?: Send },
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
	const id = ps.env("SPLATES_CONVERSATION");
	const server =
		id === undefined ? null : await serverOf({ ps, fs, log, send });
	if (id === undefined || server === null) {
		return;
	}
	const { url } = server;
	try {
		const response = await server.send(`${url}/api/conversations/${id}/task`, {
			method: "PUT",
			// The server refuses a write from any other origin than its own.
			headers: { "content-type": "application/json", origin: url },
			body: JSON.stringify({ task, from, base }),
			signal: AbortSignal.timeout(SERVER_WAIT_MS),
		});
		if (!response.ok) {
			log.error(
				`splates server did not move the conversation: ${response.status}`,
			);
		}
	} catch (error) {
		log.error(
			`splates server at ${url} could not be told of the move: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Asks `splates server` to serve the project `git` is in, so the agent a task
 * there was just handed to from another project starts: the server opens a
 * project only once something asks for it. Outside `splates server` it says
 * nothing; a server that cannot be reached is worth a line.
 */
export async function serveProject({
	ps,
	fs,
	log,
	git,
	projects,
	send,
}: {
	ps: Ps;
	fs?: Fs;
	log: Logger;
	git: Git;
	projects: Projects;
	send?: Send;
}): Promise<void> {
	const server = await serverOf({ ps, fs, log, send });
	const slug = (await projects.list()).find(
		(each) => each.root === git.root,
	)?.slug;
	if (server === null || slug === undefined) {
		return;
	}
	const { url } = server;
	try {
		const response = await server.send(`${url}/api/projects/${slug}/serve`, {
			method: "POST",
			headers: { origin: url },
			signal: AbortSignal.timeout(SERVER_WAIT_MS),
		});
		if (!response.ok) {
			log.error(`splates server did not serve ${slug}: ${response.status}`);
		}
	} catch (error) {
		log.error(
			`splates server at ${url} could not be asked to serve ${slug}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
