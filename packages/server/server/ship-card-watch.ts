import type { Resource } from "core/disposable";
import { type Conversations, SERVER_TOLD } from "../conversations";
import { stretches } from "../plans";
import { ComposeError, type ShipComposer } from "../ship";
import type { Project } from "./project";

/**
 * What tells an agent its ship card cannot be approved, and why. The card
 * stays on the page as no more than text, so the agent sends a corrected one.
 */
export function shipCardRefusal(reason: string): string {
	return `Your ship card cannot be approved: ${reason}. Run \`<command> plan\` for each target, give a bump only to a target whose plan prints one, and send the corrected card.`;
}

/**
 * Holds each ship card an agent sends to what its targets accept: when a
 * turn ends on a card `ShipComposer.check` refuses, the agent is told why,
 * rather than the person finding out at Approve.
 */
export class ShipCardWatch implements Resource {
	private readonly unlisten: () => void;

	constructor(
		private readonly project: Project,
		private readonly conversations: Conversations,
		private readonly composer: ShipComposer,
	) {
		this.unlisten = conversations.events.on("ended", (id) => {
			void this.look(id).catch((error: unknown) =>
				this.project.log.error(String(error)),
			);
		});
	}

	/** Checks the ship card a conversation's last reply ended on, if any. */
	private async look(id: string): Promise<void> {
		const conversation = (await this.conversations.list()).find(
			(each) => each.state.id === id,
		);
		const last = conversation?.state.messages.at(-1);
		if (conversation === undefined || last?.role !== "agent") {
			return;
		}
		const words = last.parts
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n\n");
		for (const stretch of stretches(words)) {
			if (
				stretch.type !== "permission" ||
				stretch.permission.action !== "ship" ||
				stretch.permission.ship === undefined
			) {
				continue;
			}
			try {
				await this.composer.check(stretch.permission.ship.picks);
			} catch (error) {
				if (!(error instanceof ComposeError)) {
					throw error;
				}
				await conversation.prompt(
					shipCardRefusal(error.message),
					[],
					undefined,
					{ told: SERVER_TOLD },
				);
				return;
			}
		}
	}

	dispose(): void {
		this.unlisten();
	}
}
