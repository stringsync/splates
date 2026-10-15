/**
 * The page's calls across projects: listing and forgetting them, and the
 * checkpoint and restart that span every project `arbor dev` serves.
 */

import type { After, Checkpoint } from "../conversations";
import type { ServerChoice } from "../dev-servers";
import type { Held } from "../held";
import type { Behind } from "../release";
import { ApiError, send, sendJson } from "./api";

/** Every arbor project on this machine, and the `arbor dev` serving them. */
export async function listProjects(): Promise<Projects> {
	const response = await fetch("/api/projects");
	if (!response.ok) {
		throw new ApiError("error", `/api/projects: ${response.status}`);
	}
	return (await response.json()) as Projects;
}

/** Drops a project from the registry, as for one that is gone for good. */
export async function forgetProject(slug: string): Promise<void> {
	await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
		method: "DELETE",
	}).then(async (response) => {
		if (!response.ok) {
			const body = (await response.json().catch(() => ({}))) as {
				reason?: string;
				message?: string;
			};
			throw new ApiError(
				body.reason ?? "error",
				body.message ?? "not forgotten",
			);
		}
	});
}

/**
 * Asks every live conversation in each of `projects`, by slug, or only those
 * `conversations` names by id, to bring its `ARBOR.md` up to date and stop,
 * each saying how it gets on in its `checkpoint`, and then does what `after`
 * says: a restart waits on them all.
 */
export async function checkpointProjects(
	projects: string[],
	after: After,
	conversations?: string[],
): Promise<void> {
	await sendJson("/api/checkpoint", "POST", {
		projects,
		after,
		...(conversations === undefined ? {} : { conversations }),
	});
}

/**
 * Tells each agent done with the checkpoint, in every project, to carry on,
 * and forgets the checkpoint of those it missed.
 */
export async function resumeCheckpoint(): Promise<void> {
	await send("/api/checkpoint/resume", {});
}

/**
 * Restarts `arbor dev` now, each agent done with the checkpoint waiting on
 * the next run to be resumed.
 */
export async function restartFromCheckpoint(): Promise<void> {
	await send("/api/checkpoint/restart", {});
}

/**
 * Restarts `arbor dev` now, or with `shutdown` shuts it down, without a
 * checkpoint: an agent at work stops mid-turn.
 */
export async function powerNow(shutdown: boolean): Promise<void> {
	await sendJson("/api/power", "POST", { shutdown });
}

/**
 * Restarts `arbor dev` now, as when every agent is idle: refused while one
 * is at work.
 */
export async function restartIdle(): Promise<void> {
	await send("/api/restart", {});
}

/** Forgets project `slug`'s checkpoint, so the next one starts afresh. */
export async function dismissCheckpoint(slug: string): Promise<void> {
	await send(inProject("/api/conversations/checkpoint", slug), {
		method: "DELETE",
	});
}

/** `path` for the project `slug` names, whichever one the page shows. */
function inProject(path: string, slug: string): string {
	return `${path}?${new URLSearchParams({ project: slug })}`;
}

/** The projects on this machine, and the `arbor dev` serving them. */
export interface Projects {
	/** Every arbor project, in the order each joined. */
	projects: ProjectChoice[];
	/** Every `arbor dev` on this machine with a host, running or not. */
	servers: ServerChoice[];
	/**
	 * The restart to follow the checkpoint under way, and whether the next
	 * run resumes its agents; null for none.
	 */
	restarting: { resume: boolean; shutdown: boolean } | null;
	/**
	 * How this run began, when a checkpoint's restart started it: its agents
	 * `waiting` to be resumed, or `resuming`, told to carry on, until each has.
	 */
	restarted: "waiting" | "resuming" | null;
	/** This run of `arbor dev`: another once it has restarted. */
	run: string;
	/** The version of arbor it runs. */
	running: string;
	/** A newer arbor, which a restart lands on; null when none is out. */
	newest: string | null;
	/** Commits to arbor's own source since this run started from it. */
	behind: Behind | null;
	/** Whether `arbor dev` can restart itself, as under its supervisor. */
	restartable: boolean;
	/**
	 * What a restart would kill, which holds an auto restart off: jobs in
	 * front in the page's shells, and commands idle agents left running.
	 */
	held: Held[];
}

/** A project the page can switch to, from the registry. */
export interface ProjectChoice {
	slug: string;
	root: string;
	/** Its repository moved or was deleted: it cannot be opened. */
	gone: boolean;
	/** The one `arbor dev` runs in, which the page shows with no `?project=`. */
	here: boolean;
	/** Its live conversations, and those a checkpoint has asked. */
	conversations: ProjectConversation[];
	/** How many of its agents wait on you. */
	waiting: number;
}

/** A conversation a checkpoint of its project asks, or has asked. */
export interface ProjectConversation {
	id: string;
	name: string;
	status: string;
	/** Where its checkpoint stands; null when none was asked for. */
	checkpoint: Checkpoint | null;
}
