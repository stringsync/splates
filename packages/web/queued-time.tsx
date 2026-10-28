import {
	makeAssistantDataUI,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Message } from "@stringsync/splates-server/conversations";
import { SERVER_TOLD } from "@stringsync/splates-server/conversations/browser";
import { taskNumberReference } from "@stringsync/splates-server/plans/browser";
import { CheckIcon, HourglassIcon } from "lucide-react";
import type { JSX } from "react";
import { sendQueuedNow } from "./conversation-api";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { usePendingWrites } from "./pending";
import { ThreadAction } from "./thread-action";
import { span } from "./work";

/** The wait before a prompt reached the agent, retained once work starts. */
export const QueuedUI = makeAssistantDataUI<{
	at: string;
	until: string | null;
	/** The stopped or failed conversation's id, its message waiting on the person. */
	halted?: string;
}>({
	name: "queued",
	render: ({ data }) => (
		<QueuedTime at={data.at} until={data.until} halted={data.halted} />
	),
});

/** Queue time stays before the reply's work, ticking until the prompt reaches the agent. */
export function queuedReply(
	reply: ThreadMessageLike,
	prompt: Message | undefined,
	halted?: string,
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
		data: {
			at: prompt.at,
			until: prompt.sentAt ?? null,
			...(halted === undefined ? {} : { halted }),
		},
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

/**
 * What the conversation held for queued task `id` will ask its agent, as
 * splates says it, queued since the conversation began.
 */
export function heldPrompt(id: number, at: string): Message {
	return {
		role: "user",
		parts: [{ type: "text", text: taskNumberReference(id) }],
		plan: null,
		at,
		until: at,
		queued: true,
		told: SERVER_TOLD,
	};
}

function QueuedTime({
	at,
	until,
	halted,
}: {
	at: string;
	until: string | null;
	halted?: string;
}): JSX.Element {
	const now = useNow(until === null && halted === undefined);
	const stuck = until === null && halted !== undefined;
	const writes = usePendingWrites();
	return (
		<div
			data-slot="queued"
			// Its icon sits where the work row's chevron does, below it.
			className="my-2 flex flex-col gap-1.5 text-muted-foreground text-sm"
		>
			<div className="flex items-center gap-1.5">
				{until !== null ? (
					<CheckIcon aria-hidden className="size-3.5 shrink-0" />
				) : (
					<HourglassIcon aria-hidden className="size-3.5 shrink-0" />
				)}
				<span
					role={until === null && !stuck ? "status" : undefined}
					className={cn(
						"min-w-0 truncate font-sans",
						until === null && !stuck && "shimmer motion-reduce:animate-none",
					)}
				>
					{stuck
						? "Waiting on you since "
						: until === null
							? "Queued "
							: "Queued for "}
					{stuck ? new Date(at).toLocaleTimeString() : span(at, until ?? now)}
				</span>
			</div>
			{stuck ? (
				<ThreadAction
					disabled={writes.pending()}
					onClick={() =>
						void writes
							.run("send", () => sendQueuedNow(halted))
							.catch(() => undefined)
					}
				>
					Send
				</ThreadAction>
			) : null}
		</div>
	);
}
