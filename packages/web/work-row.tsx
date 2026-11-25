import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import type { Compaction, Step, Tool } from "@splates/server/conversations";
import { RECONNECT } from "@splates/server/plans/browser";
import {
	CheckIcon,
	ChevronRightIcon,
	CircleIcon,
	FoldVerticalIcon,
	LoaderCircleIcon,
	ShieldIcon,
	SquareIcon,
	TriangleAlertIcon,
	UnplugIcon,
} from "lucide-react";
import { createContext, type JSX, type ReactNode, use, useState } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";
import { InMessage, useCardReply } from "./card-reply";
import { useNow } from "./hooks/use-now";
import { Markdown } from "./markdown";
import { QuietCounts } from "./quiet-events";
import { ThreadAction } from "./thread-action";
import { timeline } from "./timeline";
import { tokens } from "./usage";
import { flagged, label, type Work, warning, worked } from "./work";
import { relative, type Trees } from "./work-paths";
import { workingSpan } from "./work-time";
import { Going, TimelineItem } from "./work-timeline";

/**
 * Renders a `data-work` part: what an agent did before the words it led to,
 * as one line that says how long it took and, once done, what it added up
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

export function WorkRow({
	work,
	recorded,
}: {
	work: Work;
	recorded?: RecordedWork;
}): JSX.Element {
	// It counts up only once the agent has moved, so the row never sits at
	// 0s while the agent has yet to start.
	const since = work.until === null ? null : work.at;
	const waiting = work.waits?.some((wait) => wait.to === null) ?? false;
	const now = useNow(work.working && since !== null && !waiting);
	const items = timeline(work);
	const steps = items.filter((item) => item.type !== "decision");
	const quiet = work.events ?? [];
	const trees = use(TreesContext);
	const short = (path: string) => relative(path, trees);
	// Folded until the person opens it, while the agent works too, and open
	// from then on.
	const [open, setOpen] = useState(false);
	// The timeline is built on the first open and kept after, so reopening is
	// instant and a long thread mounts none of its folded cards.
	const [opened, setOpened] = useState(false);
	if (recorded !== undefined && steps.length === 0) {
		return (
			<p className="mb-3 text-muted-foreground text-xs">
				Worked {recorded.elapsed}
			</p>
		);
	}
	return (
		<Going value={work.going}>
			<div
				data-slot="work"
				className={cn(
					"flex flex-col gap-1.5 text-xs",
					recorded ? "mb-3" : "mt-1 mb-5",
				)}
			>
				<Collapsible
					open={recorded?.open ?? open}
					data-working={work.working || undefined}
					onOpenChange={(next) => {
						if (recorded !== undefined) {
							recorded.onOpenChange(next);
							return;
						}
						setOpen(next);
						if (next) {
							setOpened(true);
						}
					}}
					className="group/work"
				>
					<CollapsibleTrigger className="flex w-full cursor-pointer flex-wrap items-center gap-x-1.5 text-muted-foreground/70 tabular-nums hover:text-foreground md:flex-nowrap rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
						<ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/work:rotate-90 motion-reduce:transition-none" />
						<span
							className={cn(
								"min-w-0 truncate",
								work.working && "shimmer motion-reduce:animate-none",
							)}
						>
							{!work.working
								? recorded?.elapsed === undefined
									? worked(work)
									: `Worked ${recorded.elapsed}`
								: since === null
									? "Working"
									: `Working ${workingSpan(work, waiting ? Date.now() : now)}`}
						</span>
						{/* On a phone they wrap under Worked, past the chevron. */}
						<QuietCounts
							events={quiet}
							className="max-md:basis-full max-md:pl-5"
						/>
					</CollapsibleTrigger>
					<CollapsibleContent
						keepMounted
						className={
							recorded === undefined
								? "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none"
								: undefined
						}
					>
						{(recorded?.open ?? opened) &&
							(steps.length > 0 || (!work.going && work.plan !== null)) && (
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
									{steps.map((item, index) => {
										const id = item.type === "tool" ? item.tool.id : undefined;
										const call =
											id === undefined ? undefined : recorded?.calls.get(id);
										return (
											<li
												key={recorded === undefined ? index : (id ?? index)}
												id={call?.annotation ? id : undefined}
												tabIndex={call?.annotation ? -1 : undefined}
												className={
													call?.annotation ? "scroll-mt-14" : undefined
												}
											>
												<TimelineItem
													item={item}
													short={short}
													elapsed={call?.elapsed}
												/>
												{call?.annotation && (
													<div className="-ml-5 my-2">{call.annotation}</div>
												)}
											</li>
										);
									})}
								</ol>
							)}
					</CollapsibleContent>
				</Collapsible>
				{items
					.filter((item) => item.type === "decision")
					.map((item, index) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: decisions retain their order
							key={index}
							data-slot="permission-decision"
							className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-sm"
						>
							<ShieldIcon className="size-3 shrink-0" />
							<TimelineItem item={item} short={short} />
						</div>
					))}
				{work.working && work.plan !== null && <Plan steps={work.plan} />}
				<Flags tools={flagged(work)} short={short} />
			</div>
		</Going>
	);
}

export interface RecordedCall {
	elapsed: string | undefined;
	annotation: ReactNode;
}

// vet-ignore objects-over-callbacks: controlled state for the collapsible React component
export interface RecordedWork {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	elapsed: string | undefined;
	calls: ReadonlyMap<string, RecordedCall>;
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
						<Collapsible className="group/flag">
							<CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm text-left text-warning text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
								<TriangleAlertIcon className="size-3.5 shrink-0" />
								<span className="min-w-0 truncate">
									{tool.flags.map(warning).join(" · ")}
								</span>
								<ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-200 group-data-open/flag:rotate-90 motion-reduce:transition-none" />
							</CollapsibleTrigger>
							<CollapsibleContent>
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
							</CollapsibleContent>
						</Collapsible>
					</li>
				);
			})}
		</ul>
	);
}

/** The agent's plan as a checklist. */
function Plan({ steps }: { steps: Step[] }): JSX.Element {
	return (
		<ul aria-label="plan" className="flex flex-col gap-1 text-sm">
			{steps.map((step, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: a plan is sent whole
					key={index}
					className={cn(
						"flex items-start gap-2 text-muted-foreground",
						step.status === "in_progress" && "font-medium text-foreground",
						step.status === "completed" && "text-muted-foreground/70",
					)}
				>
					<span className="flex h-5 shrink-0 items-center">
						{step.status === "completed" ? (
							<CheckIcon className="size-3.5" />
						) : step.status === "in_progress" ? (
							<LoaderCircleIcon className="size-3.5 animate-spin" />
						) : (
							<CircleIcon className="size-3.5 opacity-60" />
						)}
					</span>
					<span className="min-w-0 leading-5">{step.text}</span>
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
export const CompactionUI = makeAssistantDataUI<{
	compaction: Compaction;
	going?: boolean;
}>({
	name: "compaction",
	render: ({ data }) => (
		<CompactionLine compaction={data.compaction} going={data.going ?? false} />
	),
});

function CompactionLine({
	compaction,
	going,
}: {
	compaction: Compaction;
	/** The turn goes on, so a compaction yet to finish is the agent at work. */
	going: boolean;
}): JSX.Element {
	const { before, after, status, summary } = compaction;
	const [open, setOpen] = useState(false);
	const words = (
		<>
			<FoldVerticalIcon aria-hidden className="size-3.5" />
			<span
				className={cn(
					going &&
						status === "in_progress" &&
						"shimmer motion-reduce:animate-none",
				)}
			>
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
		</>
	);
	return (
		<div
			role="note"
			aria-label="context compacted"
			data-slot="compaction"
			className="my-4 text-muted-foreground text-xs"
		>
			<div className="flex items-center gap-3">
				<span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
				{summary === null ? (
					<p className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
						{words}
					</p>
				) : (
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen(!open)}
						className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap hover:text-foreground"
					>
						{words}
						<ChevronRightIcon
							aria-hidden
							className={cn("size-3.5", open && "rotate-90")}
						/>
					</button>
				)}
				<span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
			</div>
			{open && summary !== null && (
				<section
					aria-label="compaction summary"
					className="mt-3 rounded-md border bg-muted/30 p-3 text-foreground text-sm"
				>
					<Markdown text={summary} />
				</section>
			)}
		</div>
	);
}
