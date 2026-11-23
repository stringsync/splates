import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { Message, Part } from "@splates/server/conversations";
import type { JSX } from "react";
import { Transcript } from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { RecordedUserMessage } from "#web/components/assistant-ui/elements/thread-user-bubble.aui.tsx";
import { Markdown } from "./markdown";
import { like } from "./thread-messages";
import { convertMessage } from "./thread-runtime";
import type { Work } from "./work";

/** The conversation's messages without live controls or a scroll viewport. */
export function RecordedThread({
	messages,
	children,
}: {
	messages: readonly ThreadMessageLike[];
	children?: React.ReactNode;
}): JSX.Element {
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: false,
		isDisabled: true,
		onNew: ignoreNewMessage,
		convertMessage,
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			{children}
			<Transcript components={RECORDED_COMPONENTS} />
		</AssistantRuntimeProvider>
	);
}

/** Project a saved turn without interpreting its reply as live conversation cards. */
export function recordedTurn(
	id: string,
	prompt: string,
	calls: Part[],
	reply: string,
	hasWork: boolean,
): ThreadMessageLike[] {
	const message: Message = {
		role: "user",
		parts: [{ type: "text", text: prompt }],
		plan: null,
		at: null,
		until: null,
	};
	const work: Work = {
		parts: calls,
		plan: null,
		at: null,
		until: null,
		running: false,
		working: false,
		going: false,
	};
	return [
		...(prompt === "" ? [] : [like(message, 0, id)]),
		...(hasWork || reply !== ""
			? [
					{
						id: "1",
						role: "assistant" as const,
						content: [
							...(hasWork
								? [{ type: "data-work" as const, data: { work } }]
								: []),
							...(reply === "" ? [] : [{ type: "text" as const, text: reply }]),
						],
					},
				]
			: []),
	];
}

const ignoreNewMessage = async () => {};

const RECORDED_COMPONENTS = {
	UserMessage: RecordedUserMessage,
	AssistantText: ({ text }: { text: string }) => (
		<Markdown text={text} className="text-sm" />
	),
};
