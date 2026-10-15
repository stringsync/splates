import { MessageCircleQuestionMarkIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Duration } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import { age } from "../age";
import type { ConversationState } from "../conversations";
import { CHECK_IN } from "../prompts";
import { promptConversation } from "./conversation-api";
import { useNow } from "./hooks/use-now";
import type { Refuse } from "./refusal";

/** How long an agent works on what it last heard before the page offers to check in. */
export const CHECK_IN_AFTER = Duration.mins(10);

/**
 * When the agent last heard from the person: the last message it took, not
 * one still queued. A check-in it takes starts the count again.
 */
export function workingSince(conversation: ConversationState): string | null {
	const heard = conversation.messages.findLast(
		(each) => each.role === "user" && each.queued !== true,
	);
	return heard?.at ?? null;
}

/**
 * A bar above the composer once the person's own agent has worked
 * `CHECK_IN_AFTER` on what it last heard, offering to ask it where the work
 * stands with `CHECK_IN`, which it answers and carries on from. Nothing while
 * a message waits for it already, or for an agent an orchestrator answers for.
 */
export function CheckInBar({
	conversation,
	handedOut,
	waiting,
	refused,
}: {
	conversation: ConversationState;
	handedOut: boolean;
	/** Whether a message waits for the agent, which hears it before a check-in. */
	waiting: boolean;
	refused: Refuse;
}): JSX.Element | null {
	const running =
		conversation.status === "running" &&
		conversation.checkpoint === null &&
		!conversation.archived &&
		!handedOut &&
		!waiting;
	const since = running ? workingSince(conversation) : null;
	const now = useNow(since !== null);
	const [sending, setSending] = useState(false);
	if (since === null || now - Date.parse(since) < CHECK_IN_AFTER.ms) {
		return null;
	}
	return (
		<section
			aria-label="check in"
			className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-xs"
		>
			<span className="min-w-0 truncate text-muted-foreground">
				<span className="font-medium text-foreground tabular-nums">
					{age(since)}
				</span>{" "}
				since you last spoke
			</span>
			<Button
				size="sm"
				variant="outline"
				disabled={sending}
				title={CHECK_IN}
				onClick={() => {
					setSending(true);
					void promptConversation(conversation.id, CHECK_IN)
						.catch((error: unknown) => refused("Not checked in", error))
						.finally(() => setSending(false));
				}}
				className="ml-auto h-7 gap-1.5 bg-background"
			>
				<MessageCircleQuestionMarkIcon data-icon="inline-start" />
				Check in
			</Button>
		</section>
	);
}
