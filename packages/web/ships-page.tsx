import type {
	Cascade,
	CascadeStatus,
	CascadeStep,
	CascadeSummary,
	Ship,
	ShipBump,
} from "@stringsync/splates-server/ship";
import { useReactive } from "@webappwiz/react";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	MessageCircleQuestionIcon,
	PackageIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	abandonCascade,
	dropFromCascade,
	fixInCascade,
	retryInCascade,
	reviseCascadeBump,
	shipHistory,
	shipHistoryEntry,
} from "./api";
import { cn } from "./lib/utils";
import { askMachineNow } from "./machine";
import { todoAddress } from "./page-address";
import { pendingRow, usePendingWrites, useShowPending } from "./pending";
import { useProjectList } from "./project-list";
import { Refusal, useRefusals } from "./refusal";
import { hungIn, needsYou } from "./ship-activity";
import { ShipApproval } from "./ship-approval";
import { ShipWaiting } from "./ship-badge";
import { ShipBumpSelector } from "./ship-bump-selector";
import { ShipDialog, versionOf } from "./ship-dialog";
import { StageRow } from "./ship-stages";
import { TopBar } from "./top-bar";
import { type Live, useLiveShips } from "./use-live-ships";

/** The statuses a project can be dropped from the run in, as the server allows. */
const _DROPPABLE: CascadeStatus[] = [
	"waiting",
	"bumping",
	"asking",
	"stopped",
	"failed",
];

/** The statuses a project can be run again in, as the server allows. */
const RETRIABLE: CascadeStatus[] = ["stopped", "failed"];

/** The statuses whose publish has not started, so its release type can change. */
const REVISABLE: CascadeStatus[] = ["waiting", "bumping", "asking", "stopped"];

const AMBER = "text-amber-600 dark:text-amber-400";

/**
 * Every ship on this machine, across all its projects: what needs the
 * person first (npm's sign-in and codes, a bump task's questions, a project
 * stopped), then the cascade under way as a timeline with each step's time
 * against what it is expected to take, then the cascades that ended.
 */
export function ShipsPage(): JSX.Element {
	const live = useLiveShips();
	const [history, setHistory] = useState<CascadeSummary[]>([]);
	const [planning, setPlanning] = useState<ShipApproval | null>(null);
	const list = useProjectList();
	const { projects } = useReactive(
		list,
		(list) => ({ projects: list.projects }),
		["changed"],
	);
	const running = live?.cascade?.status === "running" ? live.cascade : null;
	const endedAt = live?.cascade?.ended ?? null;
	// Read when the page opens, and again as a cascade ends.
	useEffect(() => {
		void endedAt;
		shipHistory().then(setHistory, () => undefined);
	}, [endedAt]);
	const shippers = (projects ?? []).filter((each) => each.ships);
	return (
		<section aria-label="ships" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Ships" />
			{shippers.length > 0 && (
				<ul aria-label="ship a project" className="flex flex-wrap gap-2">
					{shippers.map((each) => (
						<li key={each.slug}>
							<Button
								size="sm"
								variant="outline"
								disabled={running !== null}
								title={
									running === null
										? "Shows what the ship would publish, downstream too, before anything runs"
										: "A ship is under way"
								}
								onClick={() => setPlanning(new ShipApproval(each.slug))}
							>
								<PackageIcon />
								Ship {each.slug}…
							</Button>
						</li>
					))}
				</ul>
			)}
			{planning !== null && (
				<ShipDialog approval={planning} onClose={() => setPlanning(null)} />
			)}
			{live === null && (
				<p role="status" className="text-muted-foreground text-sm">
					Reading ships…
				</p>
			)}
			{running !== null && live !== null && (
				<>
					<NeedsYou cascade={running} ship={live.ship} />
					<Timeline cascade={running} ship={live.ship} />
				</>
			)}
			{live !== null && running === null && history.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No ship has run yet. Ship a project above, or ask an agent to.
				</p>
			)}
			{history.length > 0 && <History cascades={history} />}
		</section>
	);
}

/** What waits on the person, pinned above the timeline; nothing when nothing does. */
function NeedsYou({
	cascade,
	ship,
}: {
	cascade: Cascade;
	ship: Ship | null;
}): JSX.Element | null {
	const { refusals, refuse } = useRefusals<string>();
	const writes = usePendingWrites();
	const [abandoning, setAbandoning] = useState(false);
	const asking = cascade.steps.filter((step) => step.status === "asking");
	const held = cascade.steps.filter(
		(step) =>
			step.status === "stopped" ||
			step.status === "failed" ||
			hungIn(step) !== null,
	);
	const act = (
		slug: string,
		how: "drop" | "retry" | "fix",
		step: CascadeStep,
	): void => {
		const run = {
			drop: dropFromCascade,
			retry: retryInCascade,
			fix: fixInCascade,
		};
		const done = {
			drop: "dropped",
			retry: "resumed",
			fix: "handed to an agent",
		};
		if (writes.pending(slug)) {
			return;
		}
		writes
			.run(slug, () => run[how](slug))
			.then(askMachineNow, (error: unknown) =>
				refuse(slug, `${step.slug} not ${done[how]}`, error),
			);
	};
	const abandon = () => {
		setAbandoning(true);
		abandonCascade().then(askMachineNow, (error: unknown) => {
			setAbandoning(false);
			refuse("", "Not abandoned", error);
		});
	};
	return (
		<section
			aria-label="needs you"
			className="sticky top-0 z-10 flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-background p-3"
		>
			<h2 className={cn("font-medium text-sm", AMBER)}>
				{needsYou(cascade, ship) ? "Needs you" : "Under way"}
			</h2>
			{ship !== null && <ShipWaiting ship={ship} />}
			{asking.map((step) => (
				<p key={step.slug} className="flex items-center gap-2 text-sm">
					<MessageCircleQuestionIcon className={cn("size-4", AMBER)} />
					<span>{step.slug}'s bump task asks you something.</span>
					{step.task !== null && (
						<a
							href={`?${new URLSearchParams({ project: step.slug })}${todoAddress(step.task)}`}
							className="underline-offset-2 hover:underline"
						>
							#{step.task}
						</a>
					)}
				</p>
			))}
			{held.map((step) => (
				<div key={step.slug} className="flex flex-col gap-1">
					<p className="flex items-center gap-2 text-sm">
						<CircleAlertIcon className="size-4 text-destructive" />
						<span>
							{hungIn(step) !== null
								? `${step.slug} hung at ${hungIn(step)?.name}`
								: `${step.slug} ${step.status}`}
							{step.note !== null && `: ${step.note}`}
						</span>
						{step.fix !== null && (
							<a
								href={`?${new URLSearchParams({ project: step.slug })}${todoAddress(step.fix)}`}
								title="The task an agent fixes it in; it runs again by itself once that merges"
								className="text-xs underline-offset-2 hover:underline"
							>
								fix #{step.fix}
							</a>
						)}
						<span className="ml-auto flex gap-1">
							{step.fix === null && (
								<Button
									size="xs"
									variant="ghost"
									title="Starts an agent in its project with the step, its command and the end of its output; it runs again by itself once that merges"
									disabled={writes.pending(step.slug)}
									onClick={() => act(step.slug, "fix", step)}
								>
									Fix with an agent
								</Button>
							)}
							{RETRIABLE.includes(step.status) && (
								<Button
									size="xs"
									variant="ghost"
									title={
										step.status === "failed"
											? "Runs its ship again"
											: "Queues a new bump task in its place"
									}
									disabled={writes.pending(step.slug)}
									onClick={() => act(step.slug, "retry", step)}
								>
									Resume
								</Button>
							)}
							<Button
								size="xs"
								variant="ghost"
								title="Takes it out of the run, so those after it go on without its new version"
								disabled={writes.pending(step.slug)}
								onClick={() => act(step.slug, "drop", step)}
							>
								Drop
							</Button>
						</span>
					</p>
					<Refusal refusal={refusals.get(step.slug) ?? null} />
				</div>
			))}
			<div className="flex items-center gap-2">
				<Button
					size="xs"
					variant="ghost"
					disabled={abandoning}
					title="Ends the run, stopping its ship and removing its open bump tasks; what shipped stays shipped"
					onClick={abandon}
				>
					Abandon
				</Button>
				<Refusal refusal={refusals.get("") ?? null} />
			</div>
		</section>
	);
}

/** The cascade under way, a project to a row in dependency order. */
function Timeline({
	cascade,
	ship,
}: {
	cascade: Cascade;
	ship: Ship | null;
}): JSX.Element {
	const { refusals, refuse } = useRefusals<string>();
	const writes = usePendingWrites();
	const revise = (step: CascadeStep, bump: ShipBump) => {
		if (writes.pending(step.slug)) {
			return;
		}
		writes
			.run(step.slug, () => reviseCascadeBump(step.slug, bump))
			.then(askMachineNow, (error: unknown) =>
				refuse(step.slug, `${step.slug} not changed to ${bump}`, error),
			);
	};
	return (
		<section aria-label="under way" className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">Shipping {cascade.from}</h2>
			<ol aria-label="Ship cascade" className="flex flex-col divide-y">
				{cascade.steps.map((step) => (
					<ProjectRow
						key={step.slug}
						cascade={cascade}
						step={step}
						ship={step.status === "shipping" ? ship : null}
						live
						pending={writes.pending(step.slug)}
						onRevise={
							step.action === "ship" && REVISABLE.includes(step.status)
								? (bump) => revise(step, bump)
								: null
						}
						refusal={refusals.get(step.slug) ?? null}
					/>
				))}
			</ol>
		</section>
	);
}

/** One project of a cascade: where it stands, its release, and its steps on tap. */
function ProjectRow({
	cascade,
	step,
	ship,
	live,
	onRevise = null,
	refusal = null,
	pending = false,
}: {
	cascade: Cascade;
	step: CascadeStep;
	ship: Ship | null;
	/** Whether the cascade is under way, so its times run and its log is followed. */
	live: boolean;
	/** Changes its release type before publishing, or null once that is fixed. */
	onRevise?: ((bump: ShipBump) => void) | null;
	refusal?: string | null;
	/** A change to it is on its way: held until the server answers. */
	pending?: boolean;
}): JSX.Element {
	const [open, setOpen] = useState(step.status === "shipping");
	const showPending = useShowPending(pending);
	return (
		<li
			aria-label={step.slug}
			{...pendingRow(pending, showPending, "flex flex-col gap-1 py-2")}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 text-left text-sm"
			>
				<ChevronRightIcon
					aria-hidden
					className={cn("size-3.5 transition-transform", open && "rotate-90")}
				/>
				<span
					aria-hidden
					className={cn("size-1.5 shrink-0 rounded-full", DOTS[step.status])}
				/>
				<span className="font-medium">{step.slug}</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{step.action === "ship" ? versionOf(step) : "bump"}
				</span>
				<span className="ml-auto text-muted-foreground text-xs">
					{STATUSES[step.status]}
				</span>
			</button>
			{onRevise !== null && (
				<ShipBumpSelector
					label={`${step.slug} release type`}
					value={step.bump ?? "patch"}
					onChange={onRevise}
					disabled={pending}
					className="ml-5"
				/>
			)}
			<Refusal refusal={refusal} className="pl-5" />
			{open && (
				<ol aria-label={`${step.slug} steps`} className="ml-5 flex flex-col">
					{step.stages
						.filter((stage) => stage.state !== "skipped")
						.map((stage) => (
							<StageRow
								key={stage.key}
								cascade={cascade}
								step={step}
								stage={stage}
								ship={ship}
								live={live}
							/>
						))}
				</ol>
			)}
		</li>
	);
}

/** The cascades that ended, newest first, each opening as the timeline it was. */
function History({ cascades }: { cascades: CascadeSummary[] }): JSX.Element {
	return (
		<section aria-label="history" className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">History</h2>
			<ul className="flex flex-col divide-y">
				{cascades
					.filter((each) => each.status !== "running")
					.map((each) => (
						<Past key={each.id} summary={each} />
					))}
			</ul>
		</section>
	);
}

function Past({ summary }: { summary: CascadeSummary }): JSX.Element {
	const [open, setOpen] = useState(false);
	const [kept, setKept] = useState<Live | null>(null);
	useEffect(() => {
		if (open && kept === null) {
			shipHistoryEntry(summary.id).then(setKept, () => undefined);
		}
	}, [open, kept, summary.id]);
	const stopped = summary.projects.find(
		(each) => each.status !== "done" && each.status !== "dropped",
	);
	return (
		<li aria-label={summary.id} className="flex flex-col gap-1 py-2">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 text-left text-sm"
			>
				<ChevronRightIcon
					aria-hidden
					className={cn("size-3.5 transition-transform", open && "rotate-90")}
				/>
				<span className="font-medium">{summary.from}</span>
				<span className="text-muted-foreground text-xs">
					{summary.status === "abandoned"
						? `abandoned${stopped === undefined ? "" : ` at ${stopped.slug}`}`
						: `${summary.projects.length} project${summary.projects.length === 1 ? "" : "s"}`}
				</span>
				<time
					dateTime={summary.started}
					className="ml-auto text-muted-foreground text-xs"
				>
					{new Date(summary.started).toLocaleString()}
				</time>
			</button>
			{open && kept === null && (
				<p className="pl-5 text-muted-foreground text-xs">Reading…</p>
			)}
			{open && kept?.cascade != null && (
				<ol
					aria-label={`${summary.from} steps`}
					className="ml-5 flex flex-col divide-y"
				>
					{kept.cascade.steps.map((step) => (
						<ProjectRow
							key={step.slug}
							cascade={kept.cascade as Cascade}
							step={step}
							ship={null}
							live={false}
						/>
					))}
				</ol>
			)}
		</li>
	);
}

/** What each status says of a project, beside it. */
const STATUSES: Record<CascadeStatus, string> = {
	waiting: "waiting",
	bumping: "bumping",
	asking: "asks you",
	stopped: "stopped",
	shipping: "publishing",
	failed: "failed",
	done: "done",
	dropped: "dropped",
	abandoned: "abandoned",
};

const DOTS: Record<CascadeStatus, string> = {
	waiting: "bg-muted-foreground/40",
	bumping: "bg-info",
	asking: "bg-amber-500",
	stopped: "bg-destructive",
	shipping: "bg-info",
	failed: "bg-destructive",
	done: "bg-emerald-500",
	dropped: "bg-muted-foreground/40",
	abandoned: "bg-muted-foreground/40",
};
