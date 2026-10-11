"use client";

import {
	ActionBarMorePrimitive,
	ActionBarPrimitive,
	type AssistantState,
	AuiIf,
	BranchPickerPrimitive,
	ComposerPrimitive,
	ErrorPrimitive,
	type FileMessagePartComponent,
	groupPartByType,
	type ImageMessagePartComponent,
	MessagePrimitive,
	SuggestionPrimitive,
	type TextMessagePartComponent,
	ThreadPrimitive,
	type ToolCallMessagePartComponent,
	type TriggerAdapter,
	type Unstable_DirectiveFormatter,
	useAuiState,
} from "@assistant-ui/react";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	AudioLinesIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	DownloadIcon,
	MicIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PhoneIcon,
	RefreshCwIcon,
	SquareIcon,
	ThumbsDownIcon,
	ThumbsUpIcon,
} from "lucide-react";
import {
	type ComponentType,
	createContext,
	type FC,
	type PropsWithChildren,
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	ComposerAttachments,
	UserMessageAttachments,
} from "#dev/components/assistant-ui/elements/attachment.aui.tsx";
import { File } from "#dev/components/assistant-ui/elements/file.tsx";
import { ThreadFollowupSuggestions } from "#dev/components/assistant-ui/elements/follow-up-suggestions.aui.tsx";
import { Image } from "#dev/components/assistant-ui/elements/image.tsx";
import { MarkdownText } from "#dev/components/assistant-ui/elements/markdown-text.tsx";
import {
	Reasoning,
	ReasoningContent,
	ReasoningRoot,
	ReasoningText,
	ReasoningTrigger,
} from "#dev/components/assistant-ui/elements/reasoning.aui.tsx";
import { ToolFallback } from "#dev/components/assistant-ui/elements/tool-fallback.aui.tsx";
import {
	ToolGroupContent,
	ToolGroupRoot,
	ToolGroupTrigger,
} from "#dev/components/assistant-ui/elements/tool-group.aui.tsx";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Skeleton } from "#dev/components/ui/skeleton.tsx";
import { cn } from "#dev/lib/utils.ts";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

const reasoningDuration = (timing: ThreadGroupPart["timing"]) =>
	timing?.completedAt === undefined
		? undefined
		: Math.round((timing.completedAt - timing.startedAt) / 1000);

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`. When `TaskGroup` is set, tool calls that carry a nested
 * conversation and have no registered UI render through it instead of the
 * tool group; without it they render like any other tool call.
 */
export type ThreadComponents = {
	AssistantMessage?: ComponentType | undefined;
	Welcome?: ComponentType | undefined;
	ToolFallback?: ToolCallMessagePartComponent | undefined;
	ToolGroup?:
		| ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
		| undefined;
	ReasoningGroup?:
		| ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
		| undefined;
	TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
};

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

export type ThreadProps = {
	components?: ThreadComponents | undefined;
	autoFocus?: boolean | undefined;
	/** Shown just above the composer, such as what the agent is asking. */
	above?: ReactNode | undefined;
	/** Shown in place of the greeting while the thread is empty. */
	welcome?: ReactNode | undefined;
	/** In the composer's bottom row, before its buttons: the session's pickers. */
	controls?: ReactNode | undefined;
	/** What `@` offers in the composer; nothing when unset. */
	mentions?: TriggerAdapter | undefined;
};

const ThreadExtrasContext = createContext<
	Pick<ThreadProps, "above" | "welcome" | "controls" | "mentions">
>({});

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
	createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
	s.thread.messages.length === 0 &&
	(!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
	s.thread.messages.length === 0 &&
	s.thread.isLoading &&
	!s.thread.isDisabled &&
	!s.threads.isLoading;

const ThreadHistorySkeleton: FC = () => (
	<div
		data-slot="aui_thread-history-skeleton"
		role="status"
		className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] [animation-duration:200ms]"
	>
		<span className="sr-only">Loading conversation</span>
		<Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
		<div className="flex flex-col gap-y-2">
			<Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
			<Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
			<Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
		</div>
		<Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
		<div className="flex flex-col gap-y-2">
			<Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
			<Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
		</div>
	</div>
);

export const Thread: FC<ThreadProps> = ({
	components = EMPTY_COMPONENTS,
	autoFocus = true,
	above,
	welcome,
	controls,
	mentions,
}) => {
	const isEmpty = useAuiState(isNewChatView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<ThreadExtrasContext.Provider
				value={{ above, welcome, controls, mentions }}
			>
				<ThreadRoot isEmpty={isEmpty} autoFocus={autoFocus} />
			</ThreadExtrasContext.Provider>
		</ThreadComponentsContext.Provider>
	);
};

const ThreadRoot: FC<{ isEmpty: boolean; autoFocus: boolean }> = ({
	isEmpty,
	autoFocus,
}) => {
	const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
	const { welcome } = useContext(ThreadExtrasContext);
	const viewport = useRef<HTMLDivElement>(null);
	// Every scroll jumps rather than glides: assistant-ui scrolls a new message
	// to the top with `behavior: "smooth"`, which no stylesheet can override.
	useEffect(() => {
		const element = viewport.current;
		if (element === null) {
			return;
		}
		element.scrollTo = (options?: ScrollToOptions | number, y?: number) =>
			(
				HTMLElement.prototype.scrollTo as (
					this: HTMLElement,
					options: ScrollToOptions,
				) => void
			).call(
				element,
				typeof options === "number"
					? { left: options, top: y ?? 0, behavior: "instant" }
					: { ...options, behavior: "instant" },
			);
		return () => {
			delete (element as Partial<HTMLDivElement>).scrollTo;
		};
	}, []);

	return (
		<ThreadPrimitive.Root
			className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
			style={{
				["--thread-max-width" as string]: "44rem",
				["--composer-bg" as string]:
					"color-mix(in oklab, var(--color-muted) 30%, transparent)",
				["--composer-radius" as string]: "1rem",
				["--composer-padding" as string]: "8px",
			}}
		>
			<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
				<PinnedUserMessage viewport={viewport} />
				<ThreadPrimitive.Viewport
					ref={viewport}
					turnAnchor="top"
					data-slot="aui_thread-viewport"
					className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll"
				>
					<div
						className={cn(
							"mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
							// A set distance down, not centered, so the welcome stays put
							// as what sits below it grows.
							isEmpty && "pt-[20dvh]",
						)}
					>
						<AuiIf condition={isNewChatView}>{welcome ?? <Welcome />}</AuiIf>
						<AuiIf condition={isHistoryLoadingView}>
							<ThreadHistorySkeleton />
						</AuiIf>

						<ThreadLoadEarlier />

						<div
							data-slot="aui_message-group"
							className="mb-14 flex flex-col gap-y-6 empty:hidden"
						>
							<ThreadPrimitive.Messages>
								{() => <ThreadMessage />}
							</ThreadPrimitive.Messages>
						</div>

						<ThreadPrimitive.ViewportFooter
							className={cn(
								"aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-2",
								!isEmpty &&
									"sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
							)}
						>
							<ThreadScrollToBottom />
							<ThreadFollowupSuggestions />
							<ThreadAbove />
							<Composer autoFocus={autoFocus} />
							<AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
								<ThreadSuggestions />
							</AuiIf>
						</ThreadPrimitive.ViewportFooter>
					</div>
				</ThreadPrimitive.Viewport>
			</div>
		</ThreadPrimitive.Root>
	);
};

const ThreadMessage: FC = () => {
	const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
		useContext(ThreadComponentsContext);
	const role = useAuiState((s) => s.message.role);
	const isEditing = useAuiState((s) => s.message.composer.isEditing);
	const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");

	if (isEditing) {
		return <EditComposer />;
	}
	if (isSpoken) {
		return <SpokenMessage />;
	}
	if (role === "user") {
		return <UserMessage />;
	}
	return <AssistantMessageComponent />;
};

type VoiceRunPosition = "single" | "start" | "middle" | "end";

const useVoiceRunPosition = (): VoiceRunPosition =>
	useAuiState((s) => {
		const before =
			s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
		const after =
			s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
		if (before) {
			return after ? "middle" : "end";
		}
		return after ? "start" : "single";
	});

const SpokenText: TextMessagePartComponent = ({ text }) => (
	<p className="aui-spoken-message-text m-0">{text}</p>
);

const SpokenMessage: FC = () => {
	const role = useAuiState((s) => s.message.role);
	const position = useVoiceRunPosition();
	const isSpeaking = useAuiState(
		(s) =>
			s.message.role === "assistant" && s.message.status?.type === "running",
	);
	const opensExchange = position === "start" || position === "single";

	return (
		<MessagePrimitive.Root
			data-slot="aui_spoken-message-root"
			data-role={role}
			data-voice-run={position}
			className={cn(
				"aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5 [contain-intrinsic-size:auto_48px] [content-visibility:auto]",
				position === "single" && "rounded-xl py-2",
				position === "start" && "rounded-t-xl pt-2",
				position === "middle" && "-mt-6",
				position === "end" && "-mt-6 rounded-b-xl pb-2",
			)}
		>
			{opensExchange && (
				<div
					data-slot="aui_spoken-exchange-header"
					className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"
				>
					<PhoneIcon className="size-3" aria-hidden />
					<span>Voice conversation</span>
				</div>
			)}
			<div
				data-slot="aui_spoken-message-content"
				className="text-foreground flex items-start gap-2 text-sm leading-relaxed"
			>
				<span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
					{role === "user" ? (
						<MicIcon className="size-3.5" />
					) : (
						<AudioLinesIcon className="size-3.5" />
					)}
				</span>
				<span className="sr-only">
					{role === "user" ? "You said" : "Assistant said"}
				</span>
				<div className="min-w-0 flex-1 wrap-break-word">
					<MessagePrimitive.Parts components={{ Text: SpokenText }} />
					{isSpeaking && (
						<span
							data-slot="aui_spoken-message-indicator"
							role="status"
							className="text-muted-foreground ms-1 animate-pulse font-sans"
							aria-label="Assistant is speaking"
						>
							●
						</span>
					)}
				</div>
				<SpokenActionBar />
			</div>
		</MessagePrimitive.Root>
	);
};

const SpokenActionBar: FC = () => {
	return (
		<ActionBarPrimitive.Root
			hideWhenRunning
			autohide="always"
			className="aui-spoken-action-bar text-muted-foreground flex shrink-0 gap-1"
		>
			<ActionBarPrimitive.Copy
				render={<TooltipIconButton tooltip="Copy" className="size-6" />}
			>
				<AuiIf condition={(s) => s.message.isCopied}>
					<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
				</AuiIf>
				<AuiIf condition={(s) => !s.message.isCopied}>
					<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
				</AuiIf>
			</ActionBarPrimitive.Copy>
		</ActionBarPrimitive.Root>
	);
};

const FOCUSABLE_SELECTOR =
	"a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

const nextFocusable = (start: Element) => {
	for (
		let element = start.nextElementSibling;
		element;
		element = element.nextElementSibling
	) {
		const target = element.matches(FOCUSABLE_SELECTOR)
			? element
			: element.querySelector(FOCUSABLE_SELECTOR);
		if (target instanceof HTMLElement) {
			return target;
		}
	}
	return null;
};

const ThreadLoadEarlier: FC = () => {
	const visible = useAuiState(
		(s) => s.thread.hasEarlier || s.thread.isLoadingEarlier,
	);
	const loading = useAuiState((s) => s.thread.isLoadingEarlier);
	const slotRef = useRef<HTMLDivElement>(null);
	const focusedRef = useRef<Element | null>(null);

	// The last page removes the button; a keyboard user on it continues from the
	// next control in tab order rather than from the document body.
	useLayoutEffect(() => {
		const focused = focusedRef.current;
		const slot = slotRef.current;
		if (visible || !focused || focused.isConnected || !slot) {
			return;
		}
		focusedRef.current = null;
		const active = document.activeElement;
		if (active && active !== document.body) {
			return;
		}
		nextFocusable(slot)?.focus();
	}, [visible]);

	return (
		<div
			ref={slotRef}
			className="contents"
			onFocus={(event) => {
				focusedRef.current = event.target;
			}}
		>
			<span role="status" className="sr-only">
				{loading ? "Loading earlier messages" : ""}
			</span>
			{visible && (
				<ThreadPrimitive.LoadEarlier
					render={
						<Button
							variant="ghost"
							size="sm"
							data-slot="aui_thread-load-earlier"
							className="aui-thread-load-earlier text-muted-foreground mb-6 self-center rounded-full"
						/>
					}
				>
					<span className={cn(loading && "shimmer motion-reduce:animate-none")}>
						{loading ? "Loading earlier messages" : "Load earlier messages"}
					</span>
				</ThreadPrimitive.LoadEarlier>
			)}
		</div>
	);
};

const ThreadScrollToBottom: FC = () => {
	return (
		<ThreadPrimitive.ScrollToBottom
			render={
				<TooltipIconButton
					tooltip="Scroll to bottom"
					variant="outline"
					className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
				/>
			}
		>
			<ArrowDownIcon />
		</ThreadPrimitive.ScrollToBottom>
	);
};

const ThreadWelcome: FC = () => {
	return (
		<div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
			<p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
				How can I help you today?
			</p>
		</div>
	);
};

const ThreadSuggestions: FC = () => {
	return (
		<div className="aui-thread-welcome-suggestions flex w-full flex-col">
			<ThreadPrimitive.Suggestions>
				{() => <ThreadSuggestionItem />}
			</ThreadPrimitive.Suggestions>
		</div>
	);
};

const ThreadSuggestionItem: FC = () => {
	return (
		<div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
			<SuggestionPrimitive.Trigger
				send
				render={
					<button
						type="button"
						className="aui-thread-welcome-suggestion group hover:bg-foreground/[0.03] focus-visible:ring-ring/50 flex w-full items-baseline gap-2.5 rounded-md px-2 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-1 motion-reduce:transition-none"
					/>
				}
			>
				<span
					aria-hidden
					className="text-muted-foreground/60 group-hover:text-foreground font-mono text-xs transition-colors motion-reduce:transition-none"
				>
					{">"}
				</span>
				<span className="min-w-0 flex-1 truncate">
					<SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 text-foreground" />{" "}
					<SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
				</span>
			</SuggestionPrimitive.Trigger>
		</div>
	);
};

const ThreadAbove: FC = () => {
	const { above } = useContext(ThreadExtrasContext);
	return above ?? null;
};

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
	const { mentions } = useContext(ThreadExtrasContext);
	const composer = (
		<ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
			<ComposerPrimitive.AttachmentDropzone
				render={
					<div
						data-slot="aui_composer-shell"
						className="border-foreground/10 focus-within:border-foreground/25 data-[dragging=true]:border-ring flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]"
					/>
				}
			>
				<ComposerAttachments />
				<ComposerPrimitive.Input
					placeholder="Send a message..."
					className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
					rows={1}
					autoFocus={autoFocus}
					enterKeyHint="send"
					aria-label="Message input"
				/>
				<ComposerAction />
			</ComposerPrimitive.AttachmentDropzone>
		</ComposerPrimitive.Root>
	);
	if (mentions === undefined) {
		return composer;
	}
	return (
		<ComposerPrimitive.TriggerPopoverRoot>
			<ComposerPrimitive.TriggerPopover char="@" adapter={mentions}>
				<ComposerPrimitive.TriggerPopover.Directive formatter={PLAIN_MENTION} />
				<ComposerPrimitive.TriggerPopoverItems>
					{(items) => (
						<div
							aria-label="mentions"
							className="bg-popover text-popover-foreground absolute bottom-full z-10 mb-2 w-full max-w-md rounded-xl border p-1 shadow-md"
						>
							{items.map((item, index) => (
								<ComposerPrimitive.TriggerPopoverItem
									key={item.id}
									item={item}
									index={index}
									className="data-[highlighted]:bg-accent flex w-full items-center rounded-lg px-2 py-1.5 text-start font-mono text-xs outline-none"
								>
									<span className="truncate">{item.label}</span>
								</ComposerPrimitive.TriggerPopoverItem>
							))}
						</div>
					)}
				</ComposerPrimitive.TriggerPopoverItems>
			</ComposerPrimitive.TriggerPopover>
			{composer}
		</ComposerPrimitive.TriggerPopoverRoot>
	);
};

/** A mention written as `@path`, the way agents read a file reference. */
const PLAIN_MENTION: Unstable_DirectiveFormatter = {
	serialize: (item) => `@${item.id}`,
	parse: (text) => [{ kind: "text", text }],
};

const ComposerAction: FC = () => {
	// The stop control only cancels the send while no run it could stop is going.
	const isSending = useAuiState(
		(s) =>
			s.composer.submission !== undefined &&
			!(s.thread.isRunning && s.thread.capabilities.cancel),
	);

	const { controls } = useContext(ThreadExtrasContext);

	return (
		<div className="aui-composer-action-wrapper relative flex items-center justify-between gap-2">
			{/* Conversations send text only: no attachments. */}
			<div className="flex min-w-0 items-center gap-0 overflow-hidden">
				{controls}
			</div>
			<div className="flex items-center gap-1.5">
				<AuiIf condition={(s) => s.thread.capabilities.dictation}>
					<AuiIf condition={(s) => s.composer.dictation == null}>
						<ComposerPrimitive.Dictate
							render={
								<TooltipIconButton
									tooltip="Voice input"
									side="bottom"
									type="button"
									variant="ghost"
									size="icon"
									className="aui-composer-dictate text-muted-foreground hover:text-foreground size-7 rounded-full"
									aria-label="Start voice input"
								/>
							}
						>
							<MicIcon className="aui-composer-dictate-icon size-4" />
						</ComposerPrimitive.Dictate>
					</AuiIf>
					<AuiIf condition={(s) => s.composer.dictation != null}>
						<ComposerPrimitive.StopDictation
							render={
								<TooltipIconButton
									tooltip="Stop dictation"
									side="bottom"
									type="button"
									variant="ghost"
									size="icon"
									className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
									aria-label="Stop voice input"
								/>
							}
						>
							<SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
						</ComposerPrimitive.StopDictation>
					</AuiIf>
				</AuiIf>
				<AuiIf
					condition={(s) =>
						!s.composer.canCancel ||
						(s.thread.capabilities.queue && !s.composer.isEmpty) ||
						(s.thread.voice !== undefined &&
							s.composer.submission === undefined)
					}
				>
					<ComposerPrimitive.Send
						render={
							<TooltipIconButton
								tooltip="Send message"
								side="bottom"
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-send size-7 rounded-full"
								aria-label="Send message"
							/>
						}
					>
						<ArrowUpIcon className="aui-composer-send-icon size-4" />
					</ComposerPrimitive.Send>
				</AuiIf>
				<AuiIf
					condition={(s) =>
						s.composer.canCancel &&
						!(s.thread.capabilities.queue && !s.composer.isEmpty) &&
						(s.thread.voice === undefined ||
							s.composer.submission !== undefined)
					}
				>
					<ComposerPrimitive.Cancel
						render={
							<Button
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-cancel size-7 rounded-full"
								aria-label={isSending ? "Cancel sending" : "Stop generating"}
							/>
						}
					>
						<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
					</ComposerPrimitive.Cancel>
				</AuiIf>
			</div>
		</div>
	);
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

const AssistantMessage: FC = () => {
	const {
		ToolFallback: ToolFallbackComponent = ToolFallback,
		ToolGroup,
		ReasoningGroup,
		TaskGroup: TaskGroupComponent,
	} = useContext(ThreadComponentsContext);
	const groupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;

	const ACTION_BAR_PT = "pt-1.5";
	// Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
	const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			className="fade-in slide-in-from-bottom-1 animate-in relative duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
		>
			<div
				data-slot="aui_assistant-message-content"
				className="text-foreground px-2 leading-relaxed wrap-break-word"
			>
				<MessagePrimitive.GroupedParts groupBy={groupBy}>
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
							case "file":
								return (
									<div data-slot="aui_assistant-message-file" className="py-1">
										<File {...part} />
									</div>
								);
							case "image":
								return (
									<div data-slot="aui_assistant-message-image" className="py-1">
										<Image {...part} />
									</div>
								);
							case "indicator":
								return (
									<span
										data-slot="aui_assistant-message-indicator"
										className="animate-pulse font-sans"
										aria-label="Assistant is working"
									>
										{"●"}
									</span>
								);
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

const UserFilePart: FileMessagePartComponent = (part) => (
	<div data-slot="aui_user-message-file" className="py-1">
		<File {...part} />
	</div>
);

const UserImagePart: ImageMessagePartComponent = (part) => (
	<div data-slot="aui_user-message-image" className="py-1">
		<Image {...part} />
	</div>
);

const UserMessage: FC = () => {
	const id = useAuiState((s) => s.message.id);
	return (
		<MessagePrimitive.Root
			data-slot="aui_user-message-root"
			// What `PinnedUserMessage` finds each turn's start by.
			data-message-id={id}
			className="fade-in slide-in-from-bottom-1 animate-in flex flex-col gap-y-2 px-2 duration-150"
			data-role="user"
		>
			<UserMessageAttachments />

			<div className="aui-user-message-content-wrapper relative min-w-0">
				<Clamped watch={id}>
					<MessagePrimitive.Parts
						components={{ File: UserFilePart, Image: UserImagePart }}
					/>
				</Clamped>
			</div>
		</MessagePrimitive.Root>
	);
};

/**
 * What the person said, across the thread's full width like the reply: the
 * theme's muted fill, set apart from the page, and opaque so a reply passing
 * under a pinned one stays hidden.
 */
const USER_BOX =
	"text-foreground bg-muted rounded-lg border border-foreground/15 px-4 py-2.5 wrap-break-word";

/** Lines of a message shown before it is clicked open. */
const CLAMP = "max-h-24";

/**
 * A message cut to four lines, fading out where it is cut, and opened or
 * closed again by a click (or Enter) when there is more than fits.
 */
const Clamped: FC<
	PropsWithChildren<{
		/** Changes when the words do, to measure them again. */
		watch: string;
		/** Raised by a shadow, for the pinned copy the reply passes under. */
		lifted?: boolean;
	}>
> = ({ watch, lifted = false, children }) => {
	const text = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [more, setMore] = useState(false);
	useLayoutEffect(() => {
		const box = text.current;
		if (box === null) {
			return;
		}
		const measure = () => setMore(box.scrollHeight > box.clientHeight + 1);
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(box);
		return () => watching.disconnect();
	}, [watch, open]);
	const toggle = () => (more || open) && setOpen(!open);
	return (
		<div
			role={more || open ? "button" : undefined}
			tabIndex={more || open ? 0 : undefined}
			aria-expanded={more || open ? open : undefined}
			aria-label={more || open ? (open ? "Show less" : "Show all") : undefined}
			onClick={toggle}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggle();
				}
			}}
			className={cn(
				"aui-user-message-content outline-none focus-visible:ring-2 focus-visible:ring-ring",
				USER_BOX,
				lifted && "shadow-[0_6px_16px_-6px_rgb(0_0_0/0.3)]",
				(more || open) && "cursor-pointer",
			)}
		>
			<div
				ref={text}
				className={cn(
					!open && [CLAMP, "overflow-hidden"],
					!open &&
						more &&
						"[mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
				)}
			>
				{children}
			</div>
		</div>
	);
};

/** Room above the pinned message, in pixels: the band's `pt-2`. */
const PIN_GAP = 8;

/** Room kept between the pinned message and the next one pushing it out. */
const PUSH_GAP = 16;

/**
 * The person's message for the turn being read, held atop the thread while
 * its reply scrolls under it. One at a time: the next turn's message pushes it
 * up and out as it arrives, then takes its place.
 */
const PinnedUserMessage: FC<{ viewport: RefObject<HTMLDivElement | null> }> = ({
	viewport,
}) => {
	const [pin, setPin] = useState<{ id: string; shift: number } | null>(null);
	const band = useRef<HTMLDivElement>(null);
	const replace = useRef<() => void>(() => {});
	useEffect(() => {
		const scroller = viewport.current;
		if (scroller === null) {
			return;
		}
		let frame = 0;
		const place = () => {
			frame = 0;
			const top = scroller.getBoundingClientRect().top;
			const starts = [
				...scroller.querySelectorAll<HTMLElement>(
					'[data-slot="aui_user-message-root"]',
				),
			];
			// The last turn whose message has begun to scroll out of sight.
			let at = -1;
			starts.forEach((start, index) => {
				if (start.getBoundingClientRect().top < top + PIN_GAP - 1) {
					at = index;
				}
			});
			const id = starts[at]?.dataset.messageId;
			if (id === undefined) {
				setPin(null);
				return;
			}
			const next = starts[at + 1];
			const height = band.current?.offsetHeight ?? 0;
			const shift =
				next === undefined
					? 0
					: Math.min(
							0,
							next.getBoundingClientRect().top - top - height - PUSH_GAP,
						);
			setPin((was) =>
				was?.id === id && was.shift === shift ? was : { id, shift },
			);
		};
		const soon = () => {
			frame ||= requestAnimationFrame(place);
		};
		replace.current = place;
		place();
		scroller.addEventListener("scroll", soon, { passive: true });
		const growing = new ResizeObserver(soon);
		for (const child of scroller.children) {
			growing.observe(child);
		}
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", soon);
			growing.disconnect();
		};
	}, [viewport]);
	// A new message pinned has its own height, which the push depends on.
	useLayoutEffect(() => replace.current(), [pin?.id]);
	const text = useAuiState((s) => {
		const message = s.thread.messages.find((each) => each.id === pin?.id);
		return (message?.content ?? [])
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
	});
	if (pin === null) {
		return null;
	}
	return (
		<div
			ref={band}
			data-slot="aui_pinned-user-message"
			className="pointer-events-none absolute inset-x-0 top-0 z-10"
			style={{ transform: `translateY(${pin.shift}px)` }}
		>
			{/* Opaque but for its last 0.5rem, the box's corner radius, so the
			    reply shows past the box's rounded foot rather than a square one. */}
			<div className="pointer-events-auto mx-auto w-full max-w-(--thread-max-width) bg-[linear-gradient(var(--color-background)_calc(100%-0.5rem),transparent_calc(100%-0.5rem))] px-4 pt-2">
				<div className="px-2">
					<Clamped key={pin.id} watch={pin.id} lifted>
						<p className="whitespace-pre-wrap">{text}</p>
					</Clamped>
				</div>
			</div>
		</div>
	);
};

const UserActionBar: FC = () => {
	return (
		<ActionBarPrimitive.Root
			hideWhenRunning
			autohide="not-last"
			className="aui-user-action-bar-root flex flex-col items-end"
		>
			<ActionBarPrimitive.Edit
				render={
					<TooltipIconButton tooltip="Edit" className="aui-user-action-edit" />
				}
			>
				<PencilIcon />
			</ActionBarPrimitive.Edit>
		</ActionBarPrimitive.Root>
	);
};

const EditComposer: FC = () => {
	return (
		<MessagePrimitive.Root
			data-slot="aui_edit-composer-wrapper"
			className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
		>
			<ComposerPrimitive.Root className="aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) transition-[border-color]">
				<ComposerPrimitive.Input
					className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
					autoFocus
				/>
				<div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
					<ComposerPrimitive.Cancel
						render={<Button variant="ghost" size="sm" className="h-8 px-3" />}
					>
						Cancel
					</ComposerPrimitive.Cancel>
					<ComposerPrimitive.Send
						render={<Button size="sm" className="h-8 px-3" />}
					>
						Update
					</ComposerPrimitive.Send>
				</div>
			</ComposerPrimitive.Root>
		</MessagePrimitive.Root>
	);
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
	className,
	...rest
}) => {
	return (
		<BranchPickerPrimitive.Root
			hideWhenSingleBranch
			className={cn(
				"aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
				className,
			)}
			{...rest}
		>
			<BranchPickerPrimitive.Previous
				render={<TooltipIconButton tooltip="Previous" />}
			>
				<ChevronLeftIcon />
			</BranchPickerPrimitive.Previous>
			<span className="aui-branch-picker-state font-medium">
				<BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
			</span>
			<BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}>
				<ChevronRightIcon />
			</BranchPickerPrimitive.Next>
		</BranchPickerPrimitive.Root>
	);
};
