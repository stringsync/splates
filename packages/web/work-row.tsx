import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import type {
	Compaction,
	Step,
	Tool,
} from "@stringsync/splates-server/conversations";
import { RECONNECT } from "@stringsync/splates-server/plans/browser";
import {
	CheckIcon,
	ChevronRightIcon,
	CircleIcon,
	FoldVerticalIcon,
	LoaderIcon,
	PowerIcon,
	ShieldIcon,
	SquareIcon,
	TriangleAlertIcon,
	UnplugIcon,
} from "lucide-react";
import { createContext, type JSX, use, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { InMessage, useCardReply } from "./card-reply";
import { useNow } from "./hooks/use-now";
import { Markdown } from "./markdown";
import { QuietCounts } from "./quiet-events";
import { ThreadAction } from "./thread-action";
import { type Item, timeline } from "./timeline";
import { tokens } from "./usage";
import {
	flagged,
	label,
	relative,
	span,
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
	// What the agent said along the way heads the calls after it, outside
	// the Working line, so the thread reads as a list of intentions.
	const steps = items.filter((item) => item.type !== "decision");
	const first = steps.findIndex((item) => item.type === "said");
	const lead = first === -1 ? steps : steps.slice(0, first);
	const groups = first === -1 ? [] : headlined(steps.slice(first));
	const ends = work.until ?? (work.working ? now : null);
	// Once a headline follows, the line above it holds only what came before
	// it, done, and goes when nothing did: the last headline is what works.
	const shown =
		groups.length === 0 ||
		lead.length > 0 ||
		(!work.going && work.plan !== null);
	const before = groups[0]?.said.at ?? null;
	const quiet = work.events ?? [];
	const trees = use(TreesContext);
	const short = (path: string) => relative(path, trees);
	// Folded until the person opens it, while the agent works too, and open
	// from then on.
	const [open, setOpen] = useState(false);
	// The timeline is built on the first open and kept after, so reopening is
	// instant and a long thread mounts none of its folded cards.
	const [opened, setOpened] = useState(false);
	return (
		<Going value={work.going}>
			<div data-slot="work" className="my-2 flex flex-col gap-1.5 text-sm">
				<details
					hidden={!shown}
					open={open}
					// The thread follows it as it grows while it is open.
					data-working={work.working || undefined}
					onToggle={(event) => {
						setOpen(event.currentTarget.open);
						if (event.currentTarget.open) {
							setOpened(true);
						}
					}}
					// The timeline slides open and shut with the chevron, where the
					// browser can size to `auto`; elsewhere it opens at once.
					className={cn(
						"group/work [interpolate-size:allow-keywords]",
						"details-content:h-0 details-content:overflow-clip open:details-content:h-auto",
						"details-content:transition-[height,content-visibility] details-content:transition-discrete details-content:duration-200 details-content:ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:details-content:transition-none",
					)}
				>
					<summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-1.5 text-muted-foreground hover:text-foreground md:flex-nowrap [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-open/work:rotate-90 motion-reduce:transition-none" />
						<span
							className={cn(
								"min-w-0 truncate",
								work.working &&
									groups.length === 0 &&
									"shimmer motion-reduce:animate-none",
							)}
						>
							{groups.length > 0
								? work.at === null || before === null
									? "Worked"
									: `Worked ${span(work.at, before)}`
								: !work.working
									? worked(work)
									: since === null
										? "Working"
										: `Working ${workingSpan(work, waiting ? Date.now() : now)}`}
						</span>
						{shown && quiet.length > 0 && (
							<>
								<span aria-hidden className="max-md:hidden">
									·
								</span>
								{/* On a phone they wrap under Worked, past the chevron. */}
								<QuietCounts
									events={quiet}
									className="max-md:basis-full max-md:pl-5"
								/>
							</>
						)}
					</summary>
					{opened &&
						(lead.length > 0 || (!work.going && work.plan !== null)) && (
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
								{lead.map((item, index) => (
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
						)}
				</details>
				{/* The summary is hidden when headlines head the row; the counts stand alone. */}
				{!shown && <QuietCounts events={quiet} className="pl-5" />}
				{groups.map((group, index) => (
					<Headline
						// biome-ignore lint/suspicious/noArrayIndexKey: groups only grow at the end
						key={index}
						said={group.said}
						calls={group.calls}
						took={took(group, groups[index + 1]?.said.at ?? ends)}
						live={work.working && index === groups.length - 1}
						short={short}
						// Each stands apart from the one above, so a stack of them reads
						// as separate steps; the first heads the row when the line goes.
						spaced={index > 0 || shown}
					/>
				))}
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
				{work.going && work.plan !== null && <Plan steps={work.plan} />}
				<Flags tools={flagged(work)} short={short} />
			</div>
		</Going>
	);
}

/** What the agent said, with the calls it made after, up to what it said next. */
interface Group {
	said: Extract<Item, { type: "said" }>;
	calls: Item[];
}

/** The rows from the first thing the agent said on, each said row heading the calls after it. */
function headlined(rows: Item[]): Group[] {
	const groups: Group[] = [];
	for (const row of rows) {
		if (row.type === "said") {
			groups.push({ said: row, calls: [] });
		} else {
			groups.at(-1)?.calls.push(row);
		}
	}
	return groups;
}

/** How long a group took: from its words to the next group's, or to where the turn is. */
function took(group: Group, next: string | number | null): string | null {
	const { at } = group.said;
	return at === null || next === null ? null : span(at, next);
}

/**
 * The agent's words as one faint line, shimmering while they are what it
 * works on, that opens to them in full and the calls it made after, with
 * how long they took on its right.
 */
function Headline({
	said,
	calls,
	took,
	live,
	short,
	spaced,
}: {
	said: Group["said"];
	calls: Item[];
	took: string | null;
	live: boolean;
	short: (path: string) => string;
	spaced: boolean;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	// Its calls are built on the first open and kept after, as the row's are.
	const [opened, setOpened] = useState(false);
	return (
		<details
			data-slot="headline"
			open={open}
			onToggle={(event) => {
				setOpen(event.currentTarget.open);
				if (event.currentTarget.open) {
					setOpened(true);
				}
			}}
			className={cn("group/headline", spaced && "mt-2")}
		>
			<summary className="flex cursor-pointer list-none items-start gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
				<span className="flex h-5 shrink-0 items-center">
					<ChevronRightIcon className="size-3.5 transition-transform duration-200 group-open/headline:rotate-90 motion-reduce:transition-none" />
				</span>
				<Markdown
					text={said.text}
					// Its paragraphs sit flush, so its first line meets the chevron
					// and the time; folded, that line is all of it.
					className={cn(
						"min-w-0 flex-1 text-sm leading-5 [&>*]:my-0! [&>*:not(:first-child)]:mt-[0.5lh]!",
						open
							? "text-foreground"
							: // The blocks after the first are hidden, so a first that fits the
								// line says there is more with an ellipsis, not a bare stop.
								"line-clamp-1 [&_*]:inline [&>*:not(:first-child)]:hidden! [&>*:first-child:not(:last-child)]:after:content-['…']",
						!open && live && "shimmer motion-reduce:animate-none",
					)}
				/>
				{took !== null && (
					<span className="flex h-5 shrink-0 items-center text-xs tabular-nums">
						{took}
					</span>
				)}
			</summary>
			{opened && calls.length > 0 && (
				<ol aria-label="calls" className="mt-2 flex flex-col gap-1.5 pl-5">
					{calls.map((item, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: calls only grow at the end
						<li key={index}>
							<TimelineItem item={item} short={short} />
						</li>
					))}
				</ol>
			)}
		</details>
	);
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
						<LoaderIcon className="size-3 shrink-0" />
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
 * Renders a `data-rested` part: the line that ends a persistent agent's run,
 * as the groomer's, once it is put away, so the thread says its context
 * closed there and the next run starts afresh in a conversation of its own.
 */
export const RestedUI = makeAssistantDataUI<Record<string, never>>({
	name: "rested",
	render: () => (
		<div
			role="note"
			aria-label="run ended"
			data-slot="rested"
			className="my-4 flex items-center gap-3 text-muted-foreground text-xs"
		>
			<span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
			<p className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
				<PowerIcon aria-hidden className="size-3.5" />
				Run ended, context closed
			</p>
			<span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
		</div>
	),
});

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
