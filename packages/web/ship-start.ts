import type { ConversationState } from "@stringsync/splates-server/conversations";
import { GENERAL } from "@stringsync/splates-server/projects/browser";
import { startShipRun } from "./api";
import { agentFor, NEW } from "./conversation-address";
import { promptConversation, startConversation } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";

/** Where a ship's conversation starts and is told which run to drive. */
export interface ShipStartServer {
	startRun(projects: string[]): Promise<string>;
	startConversation(agent: string): Promise<ConversationState>;
	prompt(conversation: string, text: string): Promise<unknown>;
}

const SERVER: ShipStartServer = {
	startRun: startShipRun,
	// A ship spans projects, so its conversation is General's.
	startConversation: (agent) =>
		startConversation(agent, null, { project: GENERAL }),
	prompt: (conversation, text) =>
		promptConversation(
			conversation,
			text,
			[],
			false,
			undefined,
			undefined,
			GENERAL,
		),
};

/**
 * Starts the ship the person picked on the Ships page: call `begin` with the
 * projects, and open the address it returns to talk the plan through with an
 * agent. Nothing is approved or published by starting.
 */
export class ShipStart {
	constructor(
		private readonly feed: ConversationFeed,
		private readonly server: ShipStartServer = SERVER,
	) {}

	/**
	 * Starts planning a ship of `projects`, none to replan the stopped run,
	 * and its conversation; the address of that conversation in General.
	 */
	async begin(projects: string[]): Promise<string> {
		const run = await this.server.startRun(projects);
		const agent = agentFor(NEW, this.feed.agents, this.feed.conversations);
		const started = await this.server.startConversation(agent);
		await this.server.prompt(started.id, `[SPLATES SHIP ${run}]`);
		const url = new URL(location.href);
		url.searchParams.set("project", GENERAL);
		url.searchParams.delete("ship");
		url.hash = `#conversations/${started.id}`;
		return url.toString();
	}
}
