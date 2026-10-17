import {
	makeAssistantDataUI,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import type { JSX } from "react";
import type { Message } from "../conversations";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { span } from "./work";

/** The wait before a prompt reached the agent, retained once work starts. */
export const QueuedUI = makeAssistantDataUI<{
	at: string;
	until: string | null;
}>({
	name: "queued",
	render: ({ data }) => <QueuedTime at={data.at} until={data.until} />,
});

/** Queue time stays before the reply's work, ticking until the prompt reaches the agent. */
export function queuedReply(
	reply: ThreadMessageLike,
	prompt: Message | undefined,
): ThreadMessageLike {
	if (
		reply.role !== "assistant" ||
		prompt?.role !== "user" ||
		prompt.at === null ||
		(!prompt.queued && prompt.sentAt === undefined)
	) {
		return reply;
	}
	const queued: Exclude<ThreadMessageLike["content"], string>[number] = {
		type: "data-queued",
		data: { at: prompt.at, until: prompt.sentAt ?? null },
	};
	return {
		...reply,
		content: [
			queued,
			...(prompt.queued
				? []
				: typeof reply.content === "string"
					? [{ type: "text" as const, text: reply.content }]
					: reply.content),
		],
	};
}

function QueuedTime({
	at,
	until,
}: {
	at: string;
	until: string | null;
}): JSX.Element {
	const now = useNow(until === null);
	return (
		<div data-slot="queued" className="my-2 text-sm">
			<span
				role={until === null ? "status" : undefined}
				className={cn(
					"text-muted-foreground font-sans text-sm",
					until === null && "shimmer motion-reduce:animate-none",
				)}
			>
				{until === null ? "Queued" : "Queued for"} {span(at, until ?? now)}
			</span>
		</div>
	);
}
