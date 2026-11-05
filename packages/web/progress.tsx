import { makeAssistantDataUI } from "@assistant-ui/react";
import type {
	ConversationState,
	Progress,
} from "@splates/server/conversations";
import {
	CheckIcon,
	ChevronDownIcon,
	GaugeIcon,
	Loader2Icon,
	SquareIcon,
	XIcon,
} from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { CARD_SPACE } from "./card-shell";

/**
 * Whether a conversation has something going in the background that its
 * agent reported on or started: a command running, or a progress card not
 * yet finished. The rows of the list and the Widgets button spin on it.
 */
export function backgrounded(
	conversation: Pick<ConversationState, "background" | "progress">,
): boolean {
	return (
		conversation.background.some((each) => each.state === "running") ||
		conversation.progress.some((each) => each.state === "running")
	);
}

/** The conversation's cards, live, for the thread's `data-progress` parts to read by id. */
export const ProgressCards = createContext<readonly Progress[]>([]);

/**
 * Renders a `data-progress` part: the card in the thread where the task
 * began, updating in place as the agent reports. Nothing once the card is
 * gone, as when the conversation is archived.
 */
export const ProgressUI = makeAssistantDataUI<{ id: string }>({
	name: "progress",
	render: ({ data }) => <ProgressLine id={data.id} />,
});

function ProgressLine({ id }: { id: string }): JSX.Element | null {
	const card = useContext(ProgressCards).find((each) => each.id === id);
	if (card === undefined) {
		return null;
	}
	return (
		<section
			aria-label={`progress: ${card.title}`}
			data-slot="progress"
			className={cn(
				CARD_SPACE,
				"overflow-hidden rounded-lg border bg-background py-1",
			)}
		>
			<ProgressRow progress={card} />
		</section>
	);
}

/** How many cards show before the rest wait behind a row. */
const SHOWN = 3;

/**
 * The tasks an agent reports on with `splates progress`, as a card beside
 * its thread: a bar and the latest note for each, newest first, with the
 * notes before it a click away. Nothing at all while it has reported none.
 */
export function ProgressCard({
	progress,
}: {
	progress: readonly Progress[];
}): JSX.Element | null {
	const [expanded, setExpanded] = useState(false);
	if (progress.length === 0) {
		return null;
	}
	const running = progress.filter((each) => each.state === "running");
	const newest = progress.toReversed();
	const more = newest.length - SHOWN;
	return (
		<section
			aria-label="progress"
			data-widget
			className="overflow-hidden rounded-lg border bg-background py-1"
		>
			<h3 className="flex h-8 items-center gap-2 px-3 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
				<GaugeIcon />
				<span className="flex-1">Progress</span>
				<span className="font-normal text-muted-foreground">
					{running.length > 0 ? `${running.length} running` : progress.length}
				</span>
			</h3>
			<ul>
				{(expanded ? newest : newest.slice(0, SHOWN)).map((each) => (
					<li key={each.id}>
						<ProgressRow progress={each} />
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

function ProgressRow({ progress }: { progress: Progress }): JSX.Element {
	const [open, setOpen] = useState(false);
	const { state, percent, note, history } = progress;
	return (
		<div className="px-3 py-1.5 text-sm">
			<button
				type="button"
				aria-expanded={open}
				disabled={history.length === 0}
				onClick={() => setOpen((was) => !was)}
				className="flex w-full items-center gap-2 text-left disabled:cursor-default"
			>
				<Mark state={state} />
				<span className="min-w-0 flex-1 truncate">{progress.title}</span>
				{percent !== null && (
					<span className="shrink-0 text-muted-foreground text-xs">
						{percent}%
					</span>
				)}
			</button>
			{(percent !== null || state === "running") && (
				<div
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={percent ?? undefined}
					className="my-1.5 h-1 overflow-hidden rounded-full bg-muted"
				>
					<div
						className={cn(
							"h-full rounded-full transition-[width] motion-reduce:transition-none",
							state === "failed" ? "bg-destructive" : "bg-success",
							percent === null &&
								"w-1/3 animate-pulse motion-reduce:animate-none",
						)}
						style={percent === null ? undefined : { width: `${percent}%` }}
					/>
				</div>
			)}
			{note !== "" && (
				<p className="break-words text-muted-foreground text-xs">{note}</p>
			)}
			{open && (
				<ul className="mt-1 space-y-0.5 border-l pl-2 text-muted-foreground text-xs">
					{history.toReversed().map((each) => (
						<li key={each.at} className="break-words">
							{each.note}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** How a task stands, at a glance. */
function Mark({ state }: { state: Progress["state"] }): JSX.Element {
	const label = {
		running: "Running",
		done: "Done",
		failed: "Failed",
		stopped: "Stopped",
	}[state];
	const icon = {
		running: (
			<Loader2Icon className="animate-spin motion-reduce:animate-none" />
		),
		done: <CheckIcon className="text-success" />,
		failed: <XIcon className="text-destructive" />,
		stopped: <SquareIcon />,
	}[state];
	return (
		<span role="img" aria-label={label} className="shrink-0 [&_svg]:size-3.5">
			{icon}
		</span>
	);
}
