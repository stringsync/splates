import type {
	Background,
	BackgroundState,
} from "@stringsync/splates-server/conversations";
import {
	CheckIcon,
	ChevronDownIcon,
	Loader2Icon,
	SquareIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { lineCard } from "./board";

/**
 * Opens what a conversation's background command printed in the pane beside
 * the page; null where the page has no pane.
 */
export const WatchBackground = createContext<
	((conversation: string, background: string) => void) | null
>(null);

/** How each state reads beside a command's name. */
export const SAID: Record<BackgroundState, string> = {
	running: "Running",
	completed: "Done",
	failed: "Failed",
	stopped: "Stopped",
};

/** How many of a conversation's commands its card shows until expanded. */
const SHOWN = 3;

/**
 * The commands an agent left in the background, as a card beside its
 * thread: the latest few, newest first, each saying how it stands and
 * opening what it printed, then a row that expands to the rest. Nothing at
 * all while it has left none.
 */
export function BackgroundCard({
	conversation,
	background,
}: {
	conversation: string;
	background: Background[];
}): JSX.Element | null {
	const watch = useContext(WatchBackground);
	const [expanded, setExpanded] = useState(false);
	if (background.length === 0 || watch === null) {
		return null;
	}
	const running = background.filter((each) => each.state === "running");
	const newest = background.toReversed();
	const more = newest.length - SHOWN;
	return (
		<section
			aria-label="background commands"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<TerminalIcon />
				<span className="flex-1">Background</span>
				<span className="flex items-center gap-1.5 font-normal text-muted-foreground">
					{running.length > 0 ? (
						<>
							<span
								aria-hidden
								className="size-2 animate-pulse rounded-full bg-success"
							/>
							{running.length} running
						</>
					) : (
						background.length
					)}
				</span>
			</h3>
			<ul>
				{(expanded ? newest : newest.slice(0, SHOWN)).map((each) => (
					<li key={each.id}>
						<button
							type="button"
							title={
								each.subagent === null
									? (each.command ?? each.name)
									: `${each.command ?? each.name}\nStarted by ${each.subagent.title}`
							}
							onClick={() => watch(conversation, each.id)}
							className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
						>
							<StateMark state={each.state} />
							<span className="min-w-0 flex-1 truncate">{each.name}</span>
							<span className="shrink-0 text-muted-foreground text-xs">
								{SAID[each.state]}
							</span>
						</button>
					</li>
				))}
			</ul>
			{more > 0 && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((was) => !was)}
					className="flex h-8 w-full items-center gap-2 px-3 text-left text-muted-foreground text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
				>
					<ChevronDownIcon
						aria-hidden
						className={cn(
							"size-4 shrink-0 transition-transform motion-reduce:transition-none",
							expanded && "rotate-180",
						)}
					/>
					{expanded ? "Show fewer" : `Show ${more} more`}
				</button>
			)}
		</section>
	);
}

/**
 * A bar above the composer while the agent has commands running in the
 * background, each command a chip opening what it printed in the pane, as
 * its row in the card beside the thread does: so a conversation that looks
 * idle says what it is waiting on. Nothing once none run.
 */
export function RunningBar({
	conversation,
	background,
}: {
	conversation: string;
	background: Background[];
}): JSX.Element | null {
	const watch = useContext(WatchBackground);
	const running = background.filter((each) => each.state === "running");
	if (running.length === 0 || watch === null) {
		return null;
	}
	return (
		<aside
			aria-label="Running in the background"
			className={cn(
				"flex items-center gap-2 rounded-lg border bg-card pl-3 text-sm shadow-xs",
				lineCard,
			)}
		>
			<RunningSpinner />
			<span className="shrink-0 text-muted-foreground">Running</span>
			<ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
				{running.map((each) => (
					<li key={each.id} className="min-w-0 max-w-full">
						<button
							type="button"
							title={
								each.subagent === null
									? each.name
									: `${each.name}\nStarted by ${each.subagent.title}`
							}
							onClick={() => watch(conversation, each.id)}
							className="flex h-7 max-w-full items-center rounded-md border bg-background px-2 font-mono text-xs shadow-xs transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none pointer-coarse:h-10 pointer-coarse:px-3"
						>
							<span className="truncate">{each.command ?? each.name}</span>
						</button>
					</li>
				))}
			</ul>
		</aside>
	);
}

/** How a command stands, at a glance: a pulsing dot while it runs. */
export function StateMark({ state }: { state: BackgroundState }): JSX.Element {
	return (
		<span
			aria-hidden
			className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5"
		>
			{state === "running" && (
				<span className="size-2 animate-pulse rounded-full bg-success" />
			)}
			{state === "completed" && <CheckIcon className="text-muted-foreground" />}
			{state === "failed" && <XIcon className="text-destructive" />}
			{state === "stopped" && (
				<SquareIcon className="size-2.5! fill-current text-muted-foreground" />
			)}
		</span>
	);
}

/**
 * A command still running, in a list that drops it once it ends: a spinner,
 * since a green dot reads as done.
 */
export function RunningSpinner(): JSX.Element {
	return (
		<Loader2Icon
			role="img"
			aria-label="running"
			className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
		/>
	);
}
