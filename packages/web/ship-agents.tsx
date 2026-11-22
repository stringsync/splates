import type { ConversationState } from "@splates/server/conversations";
import { useCallback, useSyncExternalStore } from "react";
import { RowIcon } from "./agent-icons";
import type { ConversationFeed } from "./conversation-feed";
import { useNameOf } from "./conversation-names";
import { shipRunAddress } from "./page-address";

const NONE: ConversationState[] = [];

/** Conversations with an agent's explicit link to this run. */
export function shipAgents(
	id: string,
	conversations: readonly ConversationState[],
): ConversationState[] {
	return conversations.filter((conversation) =>
		conversation.messages.some((message) =>
			message.parts.some(
				(part) =>
					part.type === "text" &&
					message.role === "agent" &&
					Array.from(part.text.matchAll(/#ships\/[^\s)\]>"']+/g)).some(
						(match) => match[0] === shipRunAddress(id),
					),
			),
		),
	);
}

/** Links back to the agents that proposed or mentioned the active ship. */
export function ShipAgents({
	id,
	talk,
}: {
	id: string;
	talk: ConversationFeed | null;
}) {
	const subscribe = useCallback(
		(changed: () => void) => talk?.events.on("changed", changed) ?? (() => {}),
		[talk],
	);
	const read = useCallback(() => talk?.conversations ?? NONE, [talk]);
	const conversations = useSyncExternalStore(subscribe, read, read);
	const nameOf = useNameOf();
	const agents = shipAgents(id, conversations);
	if (agents.length === 0) {
		return null;
	}
	return (
		<nav
			aria-label="Associated agents"
			className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs"
		>
			<span>Agents:</span>
			{agents.map((conversation) => (
				<a
					key={conversation.id}
					href={`#conversations/${conversation.id}`}
					className="inline-flex items-center gap-1.5 underline underline-offset-2"
				>
					<RowIcon conversation={conversation} name={nameOf(conversation)} />
					{nameOf(conversation)}
				</a>
			))}
		</nav>
	);
}
