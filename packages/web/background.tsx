import { makeAssistantDataUI } from "@assistant-ui/react";
import type {
	Background,
	BackgroundState,
	Tool,
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
import { SplatesEvent } from "./splates-event";

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
							<span aria-hidden className="size-2 rounded-full bg-success" />
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
 * Renders a `data-background` part: the line in the thread where the agent
 * left a command running in the background, one per command, saying how it
 * ended once it has.
 */
export const BackgroundUI = makeAssistantDataUI<{ tool: Tool }>({
	name: "background",
	render: ({ data }) => <BackgroundLine tool={data.tool} />,
});

/** How each way a command ends reads on its line. */
const ENDED: Record<BackgroundState, string> = {
	running: "Running in the background",
	completed: "Ran in the background",
	failed: "Failed in the background",
	stopped: "Stopped in the background",
};

function BackgroundLine({ tool }: { tool: Tool }): JSX.Element | null {
	const [expanded, setExpanded] = useState(false);
	const { background } = tool;
	if (background === undefined) {
		return null;
	}
	const { state, exitCode } = background;
	const command = tool.command ?? tool.title;
	return (
		<div role="note" aria-label="background command" data-slot="background">
			<SplatesEvent
				event={{
					mark: state === "failed" ? "failed" : null,
					words: [
						state === "running"
							? "Running"
							: state === "completed"
								? "Ran"
								: state === "failed"
									? "Failed"
									: "Stopped",
					],
					mobile: {
						words: [
							exitCode === null
								? ENDED[state]
								: `${ENDED[state]}, exit ${exitCode}`,
						],
						act: {
							label: expanded ? "Hide" : "Show",
							run: () => setExpanded((was) => !was),
						},
					},
					title: `${ENDED[state]}${exitCode === null ? "" : `, exit ${exitCode}`}`,
					act: {
						label: "Command",
						expanded,
						run: () => setExpanded((was) => !was),
					},
				}}
			/>
			{expanded && (
				<pre className="-mt-4 mb-6 overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-background p-2 text-foreground text-xs">
					<code>{command}</code>
				</pre>
			)}
		</div>
	);
}

/** How a command stands, at a glance: a green dot while it runs. */
export function StateMark({ state }: { state: BackgroundState }): JSX.Element {
	return (
		<span
			aria-hidden
			className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5"
		>
			{state === "running" && (
				<span className="size-2 rounded-full bg-success" />
			)}
			{state === "completed" && <CheckIcon className="text-muted-foreground" />}
			{state === "failed" && <XIcon className="text-destructive" />}
			{state === "stopped" && (
				<SquareIcon className="size-2.5! fill-current text-muted-foreground" />
			)}
		</span>
	);
}

/** Marks a command still running, in a list that drops it once it ends. */
export function RunningMark(): JSX.Element {
	// A loader, since a green dot reads as done.
	return (
		<Loader2Icon
			role="img"
			aria-label="running"
			className="size-3.5 shrink-0 animate-spin text-muted-foreground"
		/>
	);
}
