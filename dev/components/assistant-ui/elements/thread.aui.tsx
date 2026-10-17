"use client";

import {
	type AssistantState,
	AuiIf,
	MessageByIndexProvider,
	SuggestionPrimitive,
	ThreadPrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import {
	type FC,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import { ThreadFollowupSuggestions } from "#dev/components/assistant-ui/elements/follow-up-suggestions.aui.tsx";
import { Composer } from "#dev/components/assistant-ui/elements/thread-composer.aui.tsx";
import {
	EMPTY_COMPONENTS,
	ThreadComponentsContext,
	ThreadExtrasContext,
	type ThreadProps,
} from "#dev/components/assistant-ui/elements/thread-context.aui.ts";
import { ThreadMessage } from "#dev/components/assistant-ui/elements/thread-message.aui.tsx";
import {
	UNCLAMPED,
	useAnchorAtOnce,
	useClearOf,
	useOpenAt,
} from "#dev/components/assistant-ui/elements/thread-scroll.aui.ts";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Skeleton } from "#dev/components/ui/skeleton.tsx";
import { useTaskViewport } from "#dev/current-task.tsx";
import { carriesOn } from "#dev/directives.tsx";
import { useTouch } from "#dev/hooks/use-touch.ts";
import { cn } from "#dev/lib/utils.ts";

export const Thread: FC<ThreadProps> = ({
	components = EMPTY_COMPONENTS,
	autoFocus = true,
	above,
	welcome,
	below,
	controls,
	stopping,
	mentions,
	references,
	commands,
	placeholder,
	composer,
	openAt,
	docked = false,
}) => {
	const isEmpty = useAuiState(isNewChatView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<ThreadExtrasContext.Provider
				value={{
					above,
					welcome,
					below,
					controls,
					stopping,
					mentions,
					references,
					commands,
					placeholder,
					composer,
				}}
			>
				<ThreadRoot
					isEmpty={isEmpty}
					autoFocus={autoFocus}
					openAt={openAt}
					docked={docked}
				/>
			</ThreadExtrasContext.Provider>
		</ThreadComponentsContext.Provider>
	);
};
const ThreadRoot: FC<{
	isEmpty: boolean;
	autoFocus: boolean;
	openAt: string | undefined;
	docked: boolean;
}> = ({ isEmpty, autoFocus, openAt, docked }) => {
	const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
	const { welcome, below, composer } = useContext(ThreadExtrasContext);
	const viewport = useRef<HTMLDivElement>(null);
	// A finger taps the composer when it means to type: focus raises the
	// keyboard over half the page.
	const touch = useTouch();
	// What the current task card beside the thread reads its cards against.
	useTaskViewport(viewport);
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
	useOpenAt(viewport, openAt);
	useAnchorAtOnce(viewport);
	const footer = useRef<HTMLDivElement>(null);
	useClearOf(viewport, footer);

	return (
		<ThreadPrimitive.Root
			className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
			style={{
				["--thread-max-width" as string]: "48rem",
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
				// Clear of what sits over its right, such as docked widgets, which
				// set `--thread-inset-end`, so the messages center beside them; and
				// of the padding it reaches across, `--thread-bleed-end`, so its
				// scrollbar sits at the edge while the messages stay put.
				className="relative -me-(--thread-bleed-end,0px) flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-scroll pe-[calc(var(--thread-inset-end,0px)+var(--thread-bleed-end,0px))]"
			>
				<div
					className={cn(
						// A phone's messages reach as wide as the composer: half the
						// padding here, and the other half on the composer's footer.
						"mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4 max-md:px-2",
						// A set distance down, not centered, so the welcome stays put
						// as what sits below it grows; docked, it centers over the
						// composer, which stays put instead.
						isEmpty && !docked && "pt-[20dvh]",
					)}
				>
					<AuiIf condition={isNewChatView}>
						{docked ? (
							<div className="my-auto">{welcome ?? <Welcome />}</div>
						) : (
							(welcome ?? <Welcome />)
						)}
					</AuiIf>
					<AuiIf condition={isHistoryLoadingView}>
						<ThreadHistorySkeleton />
					</AuiIf>

					<ThreadLoadEarlier />

					<div
						data-slot="aui_message-group"
						// Margins, not a gap, so a card's own margin collapses into the
						// space between turns rather than adding to it.
						className="mb-14 empty:hidden [&>*+*]:mt-6"
					>
						<ThreadTurns />
					</div>

					<ThreadPrimitive.ViewportFooter
						ref={footer}
						className={cn(
							"aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-2 max-md:px-2",
							// Above a user message, which sticks at z-10, so one passing
							// behind the footer does not show over the composer.
							(!isEmpty || docked) &&
								"sticky bottom-0 z-20 mt-auto rounded-t-(--composer-radius)",
						)}
					>
						<ThreadScrollToBottom />
						<ThreadFollowupSuggestions />
						<ThreadAbove />
						{composer ?? <Composer autoFocus={autoFocus && !touch} />}
						<AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
							<ThreadSuggestions />
						</AuiIf>
						<AuiIf condition={isNewChatView}>{below}</AuiIf>
					</ThreadPrimitive.ViewportFooter>
				</div>
			</ThreadPrimitive.Viewport>
		</ThreadPrimitive.Root>
	);
};
/**
 * The thread's messages, a box for each turn: the person's message and every
 * reply up to their next one. A turn's box is what holds its message stuck
 * atop the thread while the reply is read, until the box scrolls out and the
 * next turn's message pushes it along. A bare line, as a checkpoint is, opens
 * no turn of its own, so it never pushes the stuck message out.
 */
const ThreadTurns: FC = () => {
	const roster = useAuiState((s) =>
		s.thread.messages
			.map((each) => `${carriesOn(each) ? "line" : each.role} ${each.id}`)
			.join("\n"),
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
			// Margins, as between turns, so cards sit as far apart across
			// messages as within one. The 2rem below a stuck message is what
			// keeps its fade clear of the reply.
			className="[&>*+*]:mt-6 [&>[data-sticks]+*]:mt-8"
		>
			{turn.map(({ id, index }) => (
				<MessageByIndexProvider key={id} index={index}>
					<ThreadMessage />
				</MessageByIndexProvider>
			))}
		</div>
	));
};
const FOCUSABLE_SELECTOR =
	"a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [contenteditable='true'], [tabindex]:not([tabindex='-1']):not([disabled])";
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
		<div className="aui-thread-welcome-suggestions flex w-full flex-col empty:hidden">
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
