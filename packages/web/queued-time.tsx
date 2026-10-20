import {
	makeAssistantDataUI,
	type ThreadMessageLike,
} from "@assistant-ui/react";
import type { Message } from "@stringsync/splates-server/conversations";
import { SERVER_TOLD } from "@stringsync/splates-server/conversations/browser";
import { taskNumberReference } from "@stringsync/splates-server/plans/browser";
import { CheckIcon, HourglassIcon } from "lucide-react";
import type { JSX } from "react";
import { WorkingIndicator } from "#web/components/assistant-ui/elements/thread-assistant-message.aui.tsx";
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

/**
 * Says Working under a turn still going with messages queued after it, as
 * `working` marks it: register it with the thread's other data parts.
 */
export const GoingUI = makeAssistantDataUI<Record<string, never>>({
	name: "going",
	render: () => <WorkingIndicator />,
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

/**
 * `thread` with a `data-going` part on its last reply when `going`, its
 * turn still running with messages queued after it, which take the place
 * assistant-ui shows Working under.
 */
export function working(
	thread: ThreadMessageLike[],
	going: boolean,
): ThreadMessageLike[] {
	const last = thread.at(-1);
	if (
		!going ||
		last?.role !== "assistant" ||
		typeof last.content === "string"
	) {
		return thread;
	}
	return [
		...thread.slice(0, -1),
		{ ...last, content: [...last.content, { type: "data-going", data: {} }] },
	];
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
		<div
			data-slot="queued"
			// Its icon sits where the work row's chevron does, below it.
			className="my-2 flex items-center gap-1.5 text-muted-foreground text-sm"
		>
			{until === null ? (
				<HourglassIcon aria-hidden className="size-3.5 shrink-0" />
			) : (
				<CheckIcon aria-hidden className="size-3.5 shrink-0" />
			)}
			<span
				role={until === null ? "status" : undefined}
				className={cn(
					"min-w-0 truncate font-sans",
					until === null && "shimmer motion-reduce:animate-none",
				)}
			>
				{until === null ? "Queued" : "Queued for"} {span(at, until ?? now)}
			</span>
		</div>
	);
}
