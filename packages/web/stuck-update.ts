import type { Stuck } from "@splates/server/server";
import type { Snapshot } from "@splates/server/tasks";
import {
	agentFor,
	autoModelChosen,
	NEW,
	startsAuto,
} from "./conversation-address";
import {
	promptConversation,
	startAutoPick,
	startConversation,
} from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import type { Navigation } from "./navigation";
import { listProjects } from "./project-api";
import { projectUrl } from "./project-places";
import { short } from "./release";

/** The prompt sent to an agent when investigating a stuck server source checkout. */
export function stuckPrompt(stuck: Stuck): string {
	const commits = `${stuck.commits} server ${stuck.commits === 1 ? "commit" : "commits"}`;
	const dirty =
		stuck.dirty > 0
			? ` There ${stuck.dirty === 1 ? "is 1 uncommitted change" : `are ${stuck.dirty} uncommitted changes`} in ${stuck.root}.`
			: "";
	return `The splates server checkout at ${stuck.root} is ${commits} behind ${stuck.upstream} (local ${short(stuck.local)}, upstream ${short(stuck.newest)}).${dirty} Please investigate why local trunk stopped following ${stuck.upstream}, inspect any uncommitted changes so nothing valuable is lost, and help figure out whether to drop, stash, or commit them and fast-forward so the server can update.`;
}

/**
 * Starts and opens a conversation asking an agent to investigate a stuck
 * server checkout, targeting the registered project that owns `stuck.root`
 * when the page is currently viewing another project.
 */
export async function sendStuckToAgent(
	stuck: Stuck,
	{
		snapshot,
		feed,
		navigation,
		onOpen,
	}: {
		snapshot: Snapshot | null;
		feed: ConversationFeed;
		navigation: Navigation;
		onOpen: (id: string) => void;
	},
): Promise<void> {
	const text = stuckPrompt(stuck);
	let targetSlug: string | undefined;
	if (snapshot?.root !== stuck.root) {
		const listed = await listProjects().catch(() => null);
		const matched = listed?.projects.find(
			(each) => !each.gone && each.root === stuck.root,
		);
		if (matched !== undefined) {
			targetSlug = matched.slug;
		}
	}
	if (targetSlug === undefined) {
		const state = await (startsAuto(NEW) || feed.agents.length === 0
			? startAutoPick({ words: text, task: null })
			: startConversation(
					agentFor(NEW, feed.agents, feed.conversations),
					null,
					{ autoPick: autoModelChosen() },
				));
		feed.put(state);
		const sending = feed.send(state.id, text);
		void promptConversation(state.id, text, [], false, sending.id)
			.then((reply) => feed.answered(state.id, sending, reply))
			.catch((failed: unknown) => feed.refused(state.id, sending, failed));
		onOpen(state.id);
		return;
	}
	const state = await startAutoPick({ words: text, task: null }, targetSlug);
	await promptConversation(
		state.id,
		text,
		[],
		false,
		undefined,
		undefined,
		targetSlug,
	);
	const url = new URL(projectUrl({ slug: targetSlug }));
	url.hash = `#conversations/${state.id}`;
	navigation.show(url.toString());
}
