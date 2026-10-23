"use client";

import {
	ErrorPrimitive,
	groupPartByType,
	MessagePrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { type FC, useContext, useEffect, useRef, useState } from "react";
import { SystemTimer } from "webappwiz/time";
import { MarkdownText } from "#web/components/assistant-ui/elements/markdown-text.tsx";
import {
	Reasoning,
	ReasoningContent,
	ReasoningRoot,
	ReasoningText,
	ReasoningTrigger,
} from "#web/components/assistant-ui/elements/reasoning.aui.tsx";
import {
	ThreadComponentsContext,
	type ThreadGroupPart,
} from "#web/components/assistant-ui/elements/thread-context.aui.ts";
import { ToolFallback } from "#web/components/assistant-ui/elements/tool-fallback.aui.tsx";
import {
	ToolGroupContent,
	ToolGroupRoot,
	ToolGroupTrigger,
} from "#web/components/assistant-ui/elements/tool-group.aui.tsx";
import { Stamp, useStamps } from "#web/stamp.tsx";
import { SAID, type Work } from "#web/work.ts";

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
	const stamps = useStamps();
	const stamped = useAuiState((s) => {
		const at = s.message.metadata.custom.at;
		return typeof at === "string" ? at : null;
	});
	const at = stamps.shown ? stamped : null;

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			// Read tracking and scroll anchoring identify messages by this id.
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
				{at !== null && <Stamp at={at} className="mt-1 block w-fit" />}
			</div>
		</MessagePrimitive.Root>
	);
};
/**
 * Whether `tail`, the text ending a reply, changed within `SAID`, so it is
 * still streaming: false again once it holds still that long.
 */
function useStreaming(tail: string | null): boolean {
	const [streaming, setStreaming] = useState(false);
	const seen = useRef(tail);
	useEffect(() => {
		if (tail === null || tail === seen.current) {
			seen.current = tail;
			return;
		}
		seen.current = tail;
		setStreaming(true);
		const timer = new SystemTimer().setTimeout(() => setStreaming(false), SAID);
		return () => timer.dispose();
	}, [tail]);
	return streaming && tail !== null;
}

/**
 * The shimmering Working label under a busy reply, hidden while its text
 * streams and back once it pauses. Also hidden under streaming reasoning, in
 * a turn whose row of what the agent is doing still says Working above the
 * reply, or under the Queued row of what waits for the turn: the turn itself
 * says it works. Never after the
 * line saying the person stopped the turn, even before the status catches up.
 */
export const WorkingIndicator: FC = () => {
	// The text at the end of the reply, which moving means it is streaming.
	const tail = useAuiState((s) => {
		const last = s.message.parts.at(-1);
		return last?.type === "text" ? last.text : null;
	});
	const streaming = useStreaming(tail);
	const labelled = useAuiState((s) => {
		const last = s.message.parts.at(-1);
		return (
			last?.type === "reasoning" ||
			s.message.parts.some(
				(part) =>
					part.type === "data" &&
					(part.name === "stopped" ||
						(part.name === "work" &&
							(part.data as { work: Work }).work.working) ||
						(part.name === "queued" &&
							(part.data as { until: string | null }).until === null)),
			)
		);
	});
	if (labelled || streaming) {
		return null;
	}
	// Laid out as the work row's line: its spacing, its size, and its words
	// clear of where that row's chevron sits.
	return (
		<div
			data-slot="aui_assistant-message-indicator"
			role="status"
			className="my-2 flex items-center pl-5 font-sans text-muted-foreground text-sm"
		>
			<span className="min-w-0 truncate shimmer motion-reduce:animate-none">
				Working
			</span>
		</div>
	);
};
