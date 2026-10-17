import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	CheckIcon,
	ChevronRightIcon,
	CircleIcon,
	FoldVerticalIcon,
	LoaderIcon,
	ShieldIcon,
	SquareIcon,
	TriangleAlertIcon,
	UnplugIcon,
} from "lucide-react";
import { createContext, type JSX, use, useState } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Compaction, Step, Tool } from "../conversations";
import { RECONNECT } from "../prompts";
import { InMessage, useCardReply } from "./card-reply";
import { CheckIn } from "./check-in";
import { useNow } from "./hooks/use-now";
import { ThreadAction } from "./thread-action";
import { timeline } from "./timeline";
import { tokens } from "./usage";
import {
	flagged,
	label,
	relative,
	type Trees,
	type Work,
	warning,
	worked,
} from "./work";
import { workingSpan } from "./work-time";
import { Going, TimelineItem } from "./work-timeline";

/**
 * Renders a `data-work` part: what an agent did before its reply, the words
 * it said along the way included, as one line that says how long it took and, once done, what it added up
 * to, with its timeline a click away.
 */
export const WorkUI = makeAssistantDataUI<{ work: Work }>({
	name: "work",
	render: ({ data }) => <WorkRow work={data.work} />,
});

/**
 * Renders a `data-stopped` part: the line that ends a turn the person
 * stopped, as with Escape, so the thread says why it ends where it does.
 */
export const StoppedUI = makeAssistantDataUI<{ at: string }>({
	name: "stopped",
	render: () => (
		<div
			data-slot="stopped"
			className="my-2 flex items-center gap-1.5 text-muted-foreground text-sm"
		>
			<SquareIcon className="size-3 shrink-0 fill-current" />
			Stopped by you
		</div>
	),
});

/**
 * Renders a `data-interrupted` part: the line that ends a turn cut short by a
 * lost connection or a reset, so the thread says why it ends where it does.
 */
export const InterruptedUI = makeAssistantDataUI<{ at: string }>({
	name: "interrupted",
	render: () => (
		<InMessage>
			<Interrupted />
		</InMessage>
	),
});

/** Where the project's trees sit, so a path can show from the top of its own. */
export const TreesContext = createContext<Trees | null>(null);

export function WorkRow({ work }: { work: Work }): JSX.Element {
	// It counts up only once the agent has moved, so the row never sits at
	// 0s while the agent has yet to start.
	const since = work.until === null ? null : work.at;
	const waiting = work.waits?.some((wait) => wait.to === null) ?? false;
	const now = useNow(work.working && since !== null && !waiting);
	const items = timeline(work);
	const trees = use(TreesContext);
	const short = (path: string) => relative(path, trees);
	// Folded until the person opens it, while the agent works too, and open
	// from then on.
	const [open, setOpen] = useState(false);
	return (
		<Going value={work.going}>
			<div data-slot="work" className="my-2 flex flex-col gap-1.5 text-sm">
				<details
					open={open}
					onToggle={(event) => setOpen(event.currentTarget.open)}
					// The timeline slides open and shut with the chevron, where the
					// browser can size to `auto`; elsewhere it opens at once.
					className={cn(
						"group/work [interpolate-size:allow-keywords]",
						"details-content:h-0 details-content:overflow-clip open:details-content:h-auto",
						"details-content:transition-[height,content-visibility] details-content:transition-discrete details-content:duration-200 details-content:ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:details-content:transition-none",
					)}
				>
					<summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-open/work:rotate-90 motion-reduce:transition-none" />
						<span
							className={cn(
								"min-w-0 truncate",
								work.working && "shimmer motion-reduce:animate-none",
							)}
						>
							{!work.working
								? worked(work)
								: since === null
									? "Working"
									: `Working ${workingSpan(work, waiting ? Date.now() : now)}`}
						</span>
					</summary>
					<ol
						aria-label="timeline"
						// Under the line's words, clear of its chevron.
						className="mt-2 flex flex-col gap-1.5 pl-5"
					>
						{!work.going && work.plan !== null && (
							<li>
								<Plan steps={work.plan} />
							</li>
						)}
						{items
							.filter((item) => item.type !== "decision")
							.map((item, index) => (
								<li
									// The timeline only grows at its end, so an index is stable.
									// biome-ignore lint/suspicious/noArrayIndexKey: as above
									key={index}
									// The agent's words stand apart from the calls around them.
									className={cn(item.type === "said" && "py-2")}
								>
									<TimelineItem item={item} short={short} />
								</li>
							))}
					</ol>
				</details>
				{items
					.filter((item) => item.type === "decision")
					.map((item, index) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: decisions retain their order
							key={index}
							data-slot="permission-decision"
							className="flex items-center gap-1.5 text-muted-foreground text-sm"
						>
							<ShieldIcon className="size-3 shrink-0" />
							<TimelineItem item={item} short={short} />
						</div>
					))}
				{work.going && work.plan !== null && <Plan steps={work.plan} />}
				<Flags tools={flagged(work)} short={short} />
				{/* Last, under the plan and warnings, as the turn's one action. */}
				{work.working && !waiting && since !== null && (
					<InMessage>
						<CheckIn since={latest(since, work.replied)} now={now} />
					</InMessage>
				)}
			</div>
		</Going>
	);
}

/** The later of `since` and `replied`: the person has heard from the agent since it replied. */
function latest(since: string, replied: string | null): string {
	return replied !== null && replied > since ? replied : since;
}

/**
 * A warning for each command that did to git what it should not have, which
 * opens to the command, and to the main tree's files it changed.
 */
function Flags({
	tools,
	short,
}: {
	tools: Tool[];
	short: (path: string) => string;
}): JSX.Element | null {
	if (tools.length === 0) {
		return null;
	}
	return (
		<ul aria-label="warnings" className="flex flex-col gap-1">
			{tools.map((tool) => {
				const outside = tool.flags.flatMap((flag) =>
					flag.type === "outside" ? flag.paths : [],
				);
				return (
					<li key={tool.id}>
						<details>
							<summary className="flex cursor-pointer list-none items-center gap-1.5 text-warning text-xs [&::-webkit-details-marker]:hidden">
								<TriangleAlertIcon className="size-3.5 shrink-0" />
								<span className="min-w-0 truncate">
									{tool.flags.map(warning).join(" · ")}
								</span>
							</summary>
							<div className="mt-1 mb-2 flex flex-col gap-1.5 pl-5">
								<pre className="whitespace-pre-wrap break-all font-mono text-xs">
									$ {label(tool)}
								</pre>
								{outside.length > 0 && (
									<ul
										aria-label="files changed in the main tree"
										className="flex flex-col gap-0.5 font-mono text-muted-foreground text-xs"
									>
										{outside.map((path) => (
											<li key={path}>{short(path)}</li>
										))}
									</ul>
								)}
							</div>
						</details>
					</li>
				);
			})}
		</ul>
	);
}

/** The agent's plan as a checklist. */
function Plan({ steps }: { steps: Step[] }): JSX.Element {
	return (
		<ul aria-label="plan" className="flex flex-col gap-0.5 text-xs">
			{steps.map((step, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: a plan is sent whole
					key={index}
					className={cn(
						"flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3",
						step.status === "in_progress" && "text-foreground",
						step.status === "completed" && "line-through",
					)}
				>
					{step.status === "completed" ? (
						<CheckIcon className="size-3 shrink-0" />
					) : step.status === "in_progress" ? (
						<LoaderIcon className="size-3 shrink-0 animate-spin" />
					) : (
						<CircleIcon className="size-3 shrink-0" />
					)}
					{step.text}
				</li>
			))}
		</ul>
	);
}

/** The line, with a button to carry on while the person has said nothing since. */
function Interrupted(): JSX.Element {
	const { reply, sent } = useCardReply();
	const last = useAuiState(
		(state) => state.message.index === state.thread.messages.length - 1,
	);
	return (
		<div
			data-slot="interrupted"
			className="my-2 flex flex-col gap-2 text-muted-foreground text-sm"
		>
			<span className="flex items-center gap-1.5">
				<UnplugIcon className="size-3 shrink-0" />
				Interrupted, connection lost
			</span>
			{last && sent === null && reply?.send != null ? (
				<ThreadAction
					title={RECONNECT}
					onClick={() => void reply.send?.(RECONNECT)}
				>
					Reconnect
				</ThreadAction>
			) : null}
		</div>
	);
}

/**
 * Renders a `data-compaction` part: the line where the agent folded its
 * context into a summary, between the work before, which it now remembers
 * only as that summary, and the work after.
 */
export const CompactionUI = makeAssistantDataUI<{ compaction: Compaction }>({
	name: "compaction",
	render: ({ data }) => <CompactionLine compaction={data.compaction} />,
});

function CompactionLine({
	compaction,
}: {
	compaction: Compaction;
}): JSX.Element {
	const { before, after, status } = compaction;
	return (
		<div
			role="note"
			aria-label="context compacted"
			data-slot="compaction"
			className="my-4 flex items-center gap-3 text-muted-foreground text-xs"
		>
			<span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
			<p className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
				<FoldVerticalIcon aria-hidden className="size-3.5" />
				<span>
					{status === "failed"
						? "Failed to compact context"
						: status === "in_progress"
							? "Compacting context"
							: "Compacted context"}
				</span>
				{before !== null && after !== null && (
					<span className="tabular-nums">
						{tokens(before)} → {tokens(after)}
					</span>
				)}
			</p>
			<span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
		</div>
	);
}
