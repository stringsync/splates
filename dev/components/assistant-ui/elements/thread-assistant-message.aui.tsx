"use client";

import {
	ErrorPrimitive,
	groupPartByType,
	MessagePrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { type FC, useContext } from "react";
import { MarkdownText } from "#dev/components/assistant-ui/elements/markdown-text.tsx";
import {
	Reasoning,
	ReasoningContent,
	ReasoningRoot,
	ReasoningText,
	ReasoningTrigger,
} from "#dev/components/assistant-ui/elements/reasoning.aui.tsx";
import {
	ThreadComponentsContext,
	type ThreadGroupPart,
} from "#dev/components/assistant-ui/elements/thread-context.aui.ts";
import { useOpenAt } from "#dev/components/assistant-ui/elements/thread-scroll.aui.ts";
import { ToolFallback } from "#dev/components/assistant-ui/elements/tool-fallback.aui.tsx";
import {
	ToolGroupContent,
	ToolGroupRoot,
	ToolGroupTrigger,
} from "#dev/components/assistant-ui/elements/tool-group.aui.tsx";

const reasoningDuration = (timing: ThreadGroupPart["timing"]) =>
	timing?.completedAt === undefined
		? undefined
		: Math.round((timing.completedAt - timing.startedAt) / 1000);
const messageGroupBy = groupPartByType({
	reasoning: ["group-chainOfThought", "group-reasoning"],
	"tool-call": ["group-chainOfThought", "group-tool"],
	"standalone-tool-call": [],
});
type ThreadGroupKey =
	| "group-chainOfThought"
	| "group-reasoning"
	| "group-tool"
	| "group-task";
const TASK_GROUP_PATH: readonly ThreadGroupKey[] = [
	"group-chainOfThought",
	"group-task",
];
const taskAwareGroupBy = (
	part: Parameters<typeof messageGroupBy>[0],
	context?: Parameters<typeof messageGroupBy>[1],
): readonly ThreadGroupKey[] => {
	const path = messageGroupBy(part, context);
	return part.type === "tool-call" &&
		part.messages !== undefined &&
		path.length > 0 &&
		!context?.toolUIs?.[part.toolName]?.length
		? TASK_GROUP_PATH
		: path;
};
const MessageError: FC = () => {
	return (
		<MessagePrimitive.Error>
			<ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
				<ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
			</ErrorPrimitive.Root>
		</MessagePrimitive.Error>
	);
};
export const AssistantMessage: FC = () => {
	const {
		ToolFallback: ToolFallbackComponent = ToolFallback,
		ToolGroup,
		ReasoningGroup,
		TaskGroup: TaskGroupComponent,
	} = useContext(ThreadComponentsContext);
	const groupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;
	const id = useAuiState((s) => s.message.id);

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			// What `useOpenAt` finds the first unseen message by.
			data-message-id={id}
			// Always laid out, never `content-visibility: auto`: a reply it skips
			// stands in at a guessed height for a frame, whenever it mounts or
			// stops being the last, and a new turn is anchored against that.
			className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
		>
			<div
				data-slot="aui_assistant-message-content"
				className="text-foreground px-2 leading-relaxed wrap-break-word"
			>
				<MessagePrimitive.GroupedParts groupBy={groupBy} indicator="always">
					{({ part, children }) => {
						switch (part.type) {
							case "group-chainOfThought":
								return <div data-slot="aui_chain-of-thought">{children}</div>;
							case "group-task":
								return TaskGroupComponent ? (
									<TaskGroupComponent group={part} />
								) : null;
							case "group-tool":
								if (ToolGroup) {
									return <ToolGroup group={part}>{children}</ToolGroup>;
								}
								return (
									<ToolGroupRoot variant="ghost">
										<ToolGroupTrigger
											count={part.indices.length}
											active={part.status.type === "running"}
										/>
										<ToolGroupContent>{children}</ToolGroupContent>
									</ToolGroupRoot>
								);
							case "group-reasoning": {
								if (ReasoningGroup) {
									return (
										<ReasoningGroup group={part}>{children}</ReasoningGroup>
									);
								}
								const running = part.status.type === "running";
								return (
									<ReasoningRoot streaming={running}>
										<ReasoningTrigger
											active={running}
											duration={reasoningDuration(part.timing)}
										/>
										<ReasoningContent aria-busy={running}>
											<ReasoningText>{children}</ReasoningText>
										</ReasoningContent>
									</ReasoningRoot>
								);
							}
							case "text":
								return <MarkdownText />;
							case "reasoning":
								return <Reasoning {...part} />;
							case "tool-call":
								return part.toolUI ?? <ToolFallbackComponent {...part} />;
							case "data":
								return part.dataRendererUI;
							case "indicator":
								return <WorkingIndicator />;
							default:
								return null;
						}
					}}
				</MessagePrimitive.GroupedParts>
				<MessageError />
			</div>
		</MessagePrimitive.Root>
	);
};
/**
 * The shimmering Working label under a busy reply, there while its text streams
 * too, except under streaming reasoning or the row of what the agent is doing,
 * whose own labels already say so.
 */
const WorkingIndicator: FC = () => {
	const labelled = useAuiState((s) => {
		const last = s.message.parts.at(-1);
		return (
			last?.type === "reasoning" ||
			(last?.type === "data" && last.name === "work")
		);
	});
	if (labelled) {
		return null;
	}
	return (
		<span
			data-slot="aui_assistant-message-indicator"
			role="status"
			className="text-muted-foreground shimmer font-sans text-sm motion-reduce:animate-none"
		>
			Working
		</span>
	);
};
