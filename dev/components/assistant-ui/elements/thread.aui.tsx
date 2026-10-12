"use client";

import {
	ActionBarMorePrimitive,
	ActionBarPrimitive,
	type AssistantState,
	AuiIf,
	BranchPickerPrimitive,
	type CompleteAttachment,
	ComposerPrimitive,
	ErrorPrimitive,
	groupPartByType,
	MessageByIndexProvider,
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
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ComposerAddAttachment,
	ComposerAttachments,
	ImageTile,
} from "#dev/components/assistant-ui/elements/attachment.aui.tsx";
import { ThreadFollowupSuggestions } from "#dev/components/assistant-ui/elements/follow-up-suggestions.aui.tsx";
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
import { DirectiveChip } from "#dev/directives.tsx";
import { cn } from "#dev/lib/utils.ts";
import { GROUP } from "#dev/lightbox.tsx";
import { Mentioned } from "#dev/markdown.tsx";
import { leadingDirectives } from "../../../../prompts";

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
	useAnchorAtOnce(viewport);
	useOpenAt(viewport);
	const footer = useRef<HTMLDivElement>(null);
	useClearOf(viewport, footer);

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
			<ThreadPrimitive.Viewport
				ref={viewport}
				turnAnchor="top"
				topAnchorMessageClamp={UNCLAMPED}
				// `useOpenAt` places the thread as it opens instead.
				scrollToBottomOnInitialize={false}
				data-slot="aui_thread-viewport"
				className="relative flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-scroll"
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
						<ThreadTurns />
					</div>

					<ThreadPrimitive.ViewportFooter
						ref={footer}
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
		</ThreadPrimitive.Root>
	);
};

/**
 * Keeps `viewport`'s scroll padding at the bottom as tall as `footer`, which
 * sticks over the foot of the thread, so what is scrolled into view, as by
 * focusing it, lands above the composer rather than behind it.
 */
function useClearOf(
	viewport: RefObject<HTMLDivElement | null>,
	footer: RefObject<HTMLDivElement | null>,
): void {
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const over = footer.current;
		if (scroller === null || over === null) {
			return;
		}
		const measure = () => {
			scroller.style.scrollPaddingBottom = `${over.offsetHeight}px`;
		};
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(over);
		return () => watching.disconnect();
	}, [viewport, footer]);
}

/** What a turn opens the thread at, if it holds one: its last such card. */
const OPENS_THREAD = "[data-opens-thread]";

/**
 * Opens `viewport` at the top of what its last turn marks to open at, just
 * clear of the person's message stuck above it, as on a report, else at the
 * bottom, as assistant-ui would. It holds there while what is above settles,
 * as markdown and cards render, until the person scrolls, clicks or types, or
 * a reply starts and `useAnchorAtOnce` takes over.
 */
function useOpenAt(viewport: RefObject<HTMLDivElement | null>): void {
	const loaded = useAuiState((s) => s.thread.messages.length > 0);
	const running = useAuiState((s) => s.thread.isRunning);
	const release = useRef(() => {});
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const content = scroller?.firstElementChild;
		if (!loaded || scroller == null || content == null) {
			return;
		}
		const place = () => {
			const turn = [
				...scroller.querySelectorAll<HTMLElement>('[data-slot="aui_turn"]'),
			].at(-1);
			const card = [
				...(turn?.querySelectorAll<HTMLElement>(OPENS_THREAD) ?? []),
			].at(-1)?.firstElementChild;
			if (!(card instanceof HTMLElement)) {
				scroller.scrollTop = scroller.scrollHeight;
				return;
			}
			const stuck = turn?.firstElementChild;
			if (stuck instanceof HTMLElement && stuck.dataset.role === "user") {
				// Below its fade too, which `::after` paints over the reply.
				const fade = Number.parseFloat(
					getComputedStyle(stuck, "::after").height,
				);
				card.style.scrollMarginTop = `${stuck.offsetHeight + (fade || 0)}px`;
			}
			card.scrollIntoView({ block: "start", behavior: "instant" });
		};
		place();
		// Again once the parts assistant-ui renders through a renderer, as a
		// report is, have come: it registers them a commit late.
		const frame = requestAnimationFrame(place);
		const watching = new ResizeObserver(place);
		watching.observe(scroller);
		watching.observe(content);
		const gestures = ["pointerdown", "wheel", "touchstart", "keydown"];
		const stop = () => {
			cancelAnimationFrame(frame);
			watching.disconnect();
			for (const gesture of gestures) {
				scroller.removeEventListener(gesture, stop);
			}
		};
		for (const gesture of gestures) {
			scroller.addEventListener(gesture, stop, { passive: true });
		}
		release.current = stop;
		return stop;
	}, [loaded, viewport]);
	useEffect(() => {
		if (running) {
			release.current();
		}
	}, [running]);
}

/**
 * The person's message that opens the turn assistant-ui anchors to the top:
 * the one before the last, a reply, while it runs.
 */
const anchoredTurn = (s: AssistantState) => {
	const { messages, isRunning } = s.thread;
	const anchor = messages.at(-2);
	return isRunning &&
		anchor?.role === "user" &&
		messages.at(-1)?.role === "assistant"
		? anchor.id
		: undefined;
};

/**
 * No message is too tall to anchor by its top. assistant-ui would scroll past
 * the top of a tall one, leaving only its foot in view, but ours stays stuck
 * atop its turn whole, so the reply would only scroll behind it.
 */
const UNCLAMPED = { tallerThan: `${Number.MAX_SAFE_INTEGER}px` };

/** The spacer assistant-ui keeps below a turn anchored to the top. */
const RESERVE = "[data-aui-top-anchor-reserve]";

/**
 * Anchors a new turn to the top of `viewport` in the commit that adds it, as
 * assistant-ui would a frame or two later: its spacer moved below the reply
 * and sized to let the person's message reach the top, and the scroll there.
 * Left to assistant-ui, every frame in between paints the message somewhere
 * else first. Its own pass then finds nothing left to do.
 */
function useAnchorAtOnce(viewport: RefObject<HTMLDivElement | null>): void {
	const id = useAuiState(anchoredTurn);
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const anchor = scroller?.querySelector<HTMLElement>(
			`[data-role="user"][data-message-id="${CSS.escape(id ?? "")}"]`,
		);
		const target = anchor?.nextElementSibling;
		if (
			id === undefined ||
			scroller == null ||
			anchor == null ||
			!(target instanceof HTMLElement)
		) {
			return;
		}
		// Before assistant-ui has anchored a turn here it has no spacer, and
		// its own comes a frame later: a stand-in holds the room until then.
		// assistant-ui keeps its spacer by reference, so it would never take
		// one made here for its own.
		const found = scroller.querySelector<HTMLElement>(RESERVE);
		const reserve = found ?? document.createElement("div");
		if (found === null) {
			reserve.setAttribute("aria-hidden", "true");
			reserve.style.flexShrink = "0";
			reserve.style.pointerEvents = "none";
		}
		target.after(reserve);
		// By layout, as assistant-ui measures, so the fade's slide counts for
		// nothing.
		let scrollTop = 0;
		for (
			let at: HTMLElement | null = anchor;
			at != null && at !== scroller;
			at = at.offsetParent as HTMLElement | null
		) {
			scrollTop += at.offsetTop;
		}
		// Again until it holds, as assistant-ui sizes it frame by frame: while
		// the thread is shorter than the viewport, the room it takes first
		// comes out of the space the composer's margin fills.
		for (let tries = 0; tries < 4; tries++) {
			const rest = scroller.scrollHeight - reserve.offsetHeight;
			const room = `${Math.max(0, scrollTop + scroller.clientHeight - rest)}px`;
			if (reserve.style.height === room) {
				break;
			}
			reserve.style.height = room;
		}
		const ratio = window.devicePixelRatio || 1;
		scroller.scrollTop = Math.round(scrollTop * ratio) / ratio;
		if (found !== null) {
			return;
		}
		// Its spacer comes empty, the stand-in already making the room: the
		// stand-in hands it the room before the frame paints.
		let frame = 0;
		const handOver = () => {
			const theirs = scroller.querySelector<HTMLElement>(RESERVE);
			if (theirs === null) {
				frame = requestAnimationFrame(handOver);
				return;
			}
			theirs.style.height = reserve.style.height;
			reserve.remove();
		};
		frame = requestAnimationFrame(handOver);
		return () => {
			cancelAnimationFrame(frame);
			reserve.remove();
		};
	}, [id, viewport]);
}

/**
 * The thread's messages, a box for each turn: the person's message and every
 * reply up to their next one. A turn's box is what holds its message stuck
 * atop the thread while the reply is read, until the box scrolls out and the
 * next turn's message pushes it along.
 */
const ThreadTurns: FC = () => {
	const roster = useAuiState((s) =>
		s.thread.messages.map((each) => `${each.role} ${each.id}`).join("\n"),
	);
	const turns = useMemo(() => {
		const all: { id: string; index: number }[][] = [];
		roster.split("\n").forEach((line, index) => {
			if (line === "") {
				return;
			}
			const [role, id = ""] = line.split(" ");
			const last = all.at(-1);
			if (role === "user" || last === undefined) {
				all.push([{ id, index }]);
			} else {
				last.push({ id, index });
			}
		});
		return all;
	}, [roster]);
	return turns.map((turn) => (
		<div
			key={turn[0]?.id}
			data-slot="aui_turn"
			className="flex flex-col gap-y-6"
		>
			{turn.map(({ id, index }) => (
				<MessageByIndexProvider key={id} index={index}>
					<ThreadMessage />
				</MessageByIndexProvider>
			))}
		</div>
	));
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
							className="text-muted-foreground shimmer ms-1 font-sans motion-reduce:animate-none"
						>
							Speaking
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
			<div className="flex min-w-0 items-center gap-0 overflow-hidden">
				<AuiIf condition={(s) => s.thread.capabilities.attachments}>
					<ComposerAddAttachment />
				</AuiIf>
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

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
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

/**
 * Has a person's message report, as its `offsetTop`, where it sits before it
 * sticks: its turn's box, which it opens. Stuck, the browser's reading follows
 * the scroll instead, and assistant-ui (like `useAnchorAtOnce`) sizes its
 * spacer from it, so each time it measured a stuck message the spacer grew
 * by however far the thread had scrolled, letting the reply scroll behind
 * the message with nothing more below it.
 */
const unstuckTop = (element: HTMLDivElement | null) => {
	const turn = element?.parentElement;
	if (element == null || turn == null || turn.firstElementChild !== element) {
		return;
	}
	Object.defineProperty(element, "offsetTop", {
		configurable: true,
		get: () => turn.offsetTop,
	});
	return () => {
		Reflect.deleteProperty(element, "offsetTop");
	};
};

/**
 * What the person typed, as typed, each todo it mentions a link to it, and
 * the directives it starts with as the chips the composer showed them as.
 */
const UserText: TextMessagePartComponent = ({ text }) => {
	const { directives, rest } = leadingDirectives(text);
	return (
		<>
			{directives.length > 0 && (
				<span
					data-slot="aui_user-message-directives"
					className={cn("flex flex-wrap gap-2", rest !== "" && "pb-2")}
				>
					{directives.map((directive) => (
						<DirectiveChip key={directive} directive={directive} opens />
					))}
				</span>
			)}
			{rest !== "" && (
				<p className="whitespace-pre-line">
					<Mentioned text={rest} />
				</p>
			)}
		</>
	);
};

const UserMessage: FC = () => {
	const id = useAuiState((s) => s.message.id);
	const attachments = useAuiState((s) => s.message.attachments);
	return (
		<MessagePrimitive.Root
			ref={unstuckTop}
			data-slot="aui_user-message-root"
			// What `useAnchorAtOnce` finds a new turn's start by.
			data-message-id={id}
			className={cn(
				"fade-in slide-in-from-bottom-1 animate-in flex flex-col gap-y-2 px-2 duration-150",
				// Stuck atop the thread for as long as its turn is in view. Opaque,
				// so the reply cannot show past its rounded corners, then fading
				// the reply out over the 2rem below it, which the margin and the
				// gap keep clear while it is not stuck. The margin alone is what
				// its turn holds it by, so the fade comes to the next message's
				// top as that pushes it out.
				"bg-background sticky top-0 z-10 mb-2 [container-type:scroll-state]",
				"after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-linear-to-b after:from-background after:to-transparent",
			)}
			data-role="user"
		>
			<div className="aui-user-message-content-wrapper group/user relative min-w-0">
				<Clamped watch={id} head={<ImageTiles attachments={attachments} />}>
					{/* Only words: the images it carries are attachments, shown as
					the tiles above. */}
					<MessagePrimitive.Parts components={{ Text: UserText }} />
				</Clamped>
				<UserCopy />
			</div>
		</MessagePrimitive.Root>
	);
};

/**
 * The images a message holds, at its start as the composer shows them, each
 * opening full size; nothing for a message without any.
 */
const ImageTiles: FC<{
	attachments: readonly CompleteAttachment[] | undefined;
}> = ({ attachments = [] }) => {
	const images = attachments.flatMap((attachment) =>
		(attachment.content ?? []).flatMap((part) =>
			part.type === "image" ? [{ name: attachment.name, src: part.image }] : [],
		),
	);
	if (images.length === 0) {
		return null;
	}
	return (
		<div
			data-slot="aui_user-message-images"
			// The lightbox steps through the images of one message.
			{...{ [GROUP]: "" }}
			// A tile opens the image, rather than the message it sits in.
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
			className="flex flex-wrap gap-2 pb-2"
		>
			{images.map((image) => (
				<ImageTile key={image.src} src={image.src} name={image.name} />
			))}
		</div>
	);
};

/**
 * Copies what the person said, from the message's top corner: there only
 * while the message is hovered or the button has focus, and a check once it
 * has copied. Beside the box rather than in it, since the box is itself a
 * button.
 */
const UserCopy: FC = () => (
	<ActionBarPrimitive.Copy
		render={
			<TooltipIconButton
				tooltip="Copy"
				className={cn(
					"aui-user-action-copy text-muted-foreground absolute end-1.5 top-1.5 size-6",
					"opacity-0 transition-opacity group-hover/user:opacity-100 focus-visible:opacity-100 data-copied:opacity-100",
				)}
			/>
		}
	>
		<AuiIf condition={(s) => s.message.isCopied}>
			<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
		</AuiIf>
		<AuiIf condition={(s) => !s.message.isCopied}>
			<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
		</AuiIf>
	</ActionBarPrimitive.Copy>
);

/**
 * What the person said, across the thread's full width like the reply: the
 * theme's muted fill, set apart from the page, with room at its end for the
 * copy button.
 */
const USER_BOX =
	"text-foreground bg-muted rounded-lg border border-foreground/15 ps-4 pe-9 py-2.5 wrap-break-word";

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
		/** Above the words and never cut: the images the message holds. */
		head?: ReactNode;
	}>
> = ({ watch, head, children }) => {
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
				// Raised by a shadow while its message is stuck atop the thread.
				"[@container_scroll-state(stuck:top)]:shadow-[0_6px_16px_-6px_rgb(0_0_0/0.3)]",
				(more || open) && "cursor-pointer",
			)}
		>
			{head}
			<div
				ref={text}
				className={cn(
					!open && [CLAMP, "overflow-hidden"],
					// Open, it still sticks atop the thread, so it scrolls past half
					// the screen rather than hide the reply.
					open && "max-h-[50dvh] overflow-y-auto",
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
