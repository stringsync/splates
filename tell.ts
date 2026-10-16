import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { fail } from "./exit";
import type { Projects } from "./projects";
import { reportReference } from "./prompts";
import type { Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/** What `fetch` is used for here, so a test can stand in for it. */
type Send = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The two ends of a task one conversation handed to an agent with `arbor add
 * --agent`: the caller that handed it out, and the conversation `arbor dev`
 * started for the agent. Null for any other task, which answers to the user
 * alone.
 */
export function handOff(
	worktree: Worktree,
): { caller: string; conversation: string } | null {
	const caller = worktree.caller;
	const conversation = worktree.state?.dispatch?.conversation;
	return caller === null ||
		conversation === undefined ||
		caller === conversation
		? null
		: { caller, conversation };
}

/**
 * Says `text` in the conversation of the agent a task was handed to, as the
 * user would, for the conversation that handed it out to pass on answers, a
 * merge, or what the earlier steps of its lane taught it. Only that
 * conversation may: the agent answers to it, not to whoever else asks.
 * Answers with that agent's conversation.
 */
export async function tell(
	{
		ps,
		service,
		send = fetch,
	}: { ps: Ps; service: WorktreeService; send?: Send },
	task: string,
	text: string,
): Promise<string> {
	const url = ps.env("ARBOR_DEV");
	const id = ps.env("ARBOR_CONVERSATION");
	if (url === undefined || id === undefined) {
		fail(
			"usage",
			"only an agent `arbor dev` started can tell another: outside it, say it to your own subagent",
			{ task },
		);
	}
	const worktree = await service.find(task);
	if (worktree.state === null) {
		fail(
			"not_found",
			`no task '${task}': run \`arbor list\` to see what there is`,
			{ task },
		);
	}
	const ends = handOff(worktree);
	if (ends === null || ends.caller !== id) {
		fail(
			"usage",
			`'${task}' was not handed out by this conversation: only the one that ran \`arbor add ${task} --agent\` tells its agent anything`,
			{ task },
		);
	}
	const response = await send(
		`${url}/api/conversations/${ends.conversation}/tell`,
		{
			method: "POST",
			// The server refuses a write from any other origin than its own.
			headers: { "content-type": "application/json", origin: url },
			body: JSON.stringify({ from: id, text }),
		},
	);
	if (!response.ok) {
		fail(
			"not_found",
			`arbor dev did not pass it on: ${response.status} ${await response.text()}`,
			{ task },
		);
	}
	return ends.conversation;
}

/**
 * Tells the conversation that handed `worktree` out that the task stopped,
 * escalated, merged or removed, with `[ARBOR REPORT <task>]`, so an
 * orchestrator waiting on the user hears of it too. Run before the record
 * goes, by the command that stops it. Outside `arbor dev`, or for a task
 * nobody handed out, it says nothing; a server that cannot be reached is
 * worth a line, never a failure, since the command has done its work.
 */
export async function reportToCaller(
	{
		ps,
		log,
		service,
		projects,
		send = fetch,
	}: {
		ps: Ps;
		log: Logger;
		service: WorktreeService;
		projects: Projects;
		send?: Send;
	},
	worktree: Worktree,
): Promise<void> {
	const url = ps.env("ARBOR_DEV");
	const ends = handOff(worktree);
	// The caller stopping a task it handed out already knows.
	if (
		url === undefined ||
		ends === null ||
		ends.caller === ps.env("ARBOR_CONVERSATION")
	) {
		return;
	}
	try {
		// A caller of another project's page names the task by this one's slug.
		const root = service.git.root;
		const named = (await service.holds(ends.caller))
			? worktree.task
			: `${(await projects.list()).find((each) => each.root === root)?.slug ?? root}/${worktree.task}`;
		const form = new FormData();
		form.set("text", reportReference(named));
		const response = await send(
			`${url}/api/conversations/${ends.caller}/prompt`,
			{ method: "POST", headers: { origin: url }, body: form },
		);
		if (!response.ok) {
			log.error(
				`arbor dev did not tell ${ends.caller} that '${worktree.task}' stopped: ${response.status}`,
			);
		}
	} catch (error) {
		log.error(
			`arbor dev at ${url} could not be told that '${worktree.task}' stopped: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
