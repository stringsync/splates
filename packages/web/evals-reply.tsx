import {
	AssistantRuntimeProvider,
	MessageByIndexProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { type JSX, useMemo } from "react";
import { ThreadMessage } from "#web/components/assistant-ui/elements/thread-message.aui.tsx";
import { DemoUI } from "./demo-cards";
import { QuestionsUI } from "./message-questions";
import { ReportUI } from "./report-cards";
import { ReviewUI } from "./review-panel";
import { replied } from "./thread-reply";

/**
 * An agent's reply as the page would show it: through the thread's own
 * renderer, so its questions, reports and reviews come out as the cards a
 * person would meet, not only whether the probe's check passed.
 */
export function EvalReply({ text }: { text: string }): JSX.Element {
	const messages = useMemo<ThreadMessageLike[]>(
		() => [
			{
				id: "eval-reply",
				role: "assistant",
				content: replied(text, true, { task: null, began: null, until: null }),
				status: { type: "complete", reason: "stop" },
			},
		],
		[text],
	);
	const runtime = useExternalStoreRuntime({
		messages,
		convertMessage: (message) => message,
		onNew: async () => {},
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<QuestionsUI />
			<ReviewUI />
			<ReportUI />
			<DemoUI />
			<MessageByIndexProvider index={0}>
				<ThreadMessage />
			</MessageByIndexProvider>
		</AssistantRuntimeProvider>
	);
}
