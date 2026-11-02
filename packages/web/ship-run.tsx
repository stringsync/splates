import type {
	Cascade,
	CascadeStatus,
	CascadeStep,
	Ship,
	ShipStep,
	StageKey,
	StageState,
} from "@splates/server/ship";
import { shipName } from "@splates/server/ship/browser";
import { Duration } from "core/time";
import { ExternalLinkIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { Fragment, type JSX, type ReactNode, useState } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { askMachineNow } from "./machine";
import { Refusal, useRefusals } from "./refusal";
import { type Attention, attentionOf } from "./ship-dock";
import { ICONS, StageRow, span } from "./ship-stages";

/**
 * A ship under way, or one that stopped: a stage per project in the order
 * they go, every step of each checked off as it ends, and what waits on the
 * person, or why it stopped, in the dock beneath them. Stop puts away a run
 * that ended, and abandons one still going after asking.
 */
export function ShipRun({
	cascade,
	ship,
	onClose,
	abandon: abandonRun,
	retry,
	agent,
	sendToAgent,
}: {
	cascade: Cascade;
	ship: Ship | null;
	/** Ends the run; the cascade alone by default, the run and its conversation when it has one. */
	abandon?: () => Promise<void>;
	retry?: () => Promise<void>;
	agent?: () => Promise<void>;
	/** Starts a conversation with an agent about the stage the ship failed at. */
	sendToAgent?: (failure: {
		id: string;
		project: string;
		stage: StageKey | null;
		note: string | null;
	}) => Promise<void>;
	/** Puts away a run that stopped. */
	onClose: () => void;
}): JSX.Element {
	const { refusals, refuse } = useRefusals<string>();
	const [abandoning, setAbandoning] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [acting, setActing] = useState(false);
	const act = (run: () => Promise<void>, title: string) => {
		setActing(true);
		run()
			.then(askMachineNow, (error: unknown) => refuse("", title, error))
			.finally(() => setActing(false));
	};
	const running = cascade.status === "running";
	const held = cascade.steps.find((step) => HELD.includes(step.status));
	const live = running || cascade.status === "stopped";
	// One way out: a run still going is stopped after an "are you sure".
	const close = () => {
		if (!live) {
			onClose();
			return;
		}
		if (abandonRun !== undefined) {
			setConfirming(true);
		}
	};
	const stop = () => {
		if (abandonRun === undefined) {
			return;
		}
		setConfirming(false);
		setAbandoning(true);
		abandonRun().then(
			() => {
				askMachineNow();
				onClose();
			},
			(error: unknown) => {
				setAbandoning(false);
				refuse("", "Not stopped", error);
			},
		);
	};
	const through = cascade.steps.filter(
		(step) => step.status === "done" || step.status === "dropped",
	).length;
	const failed = cascade.steps.find((step) => HELD.includes(step.status));
	const sending =
		cascade.status === "stopped" &&
		sendToAgent !== undefined &&
		failed !== undefined ? (
			<Button
				size="sm"
				className="pointer-coarse:min-h-11"
				variant="outline"
				disabled={acting || abandoning}
				onClick={() =>
					act(
						() =>
							sendToAgent({
								id: cascade.id,
								project: failed.slug,
								stage:
									failed.stages.find((stage) => stage.state === "failed")
										?.key ?? null,
								note: failed.note ?? null,
							}),
						"Not sent to an agent",
					)
				}
			>
				Send to agent
			</Button>
		) : null;
	const recovery = (
		<>
			{sending}
			{cascade.status === "stopped" &&
				agent !== undefined &&
				cascade.steps.some(
					(step) =>
						step.adopt !== "agent" &&
						step.stages.some(
							(stage) => stage.key === "adopt" && stage.state === "failed",
						),
				) && (
					<Button
						size="sm"
						className="pointer-coarse:min-h-11"
						variant="outline"
						disabled={acting || abandoning}
						onClick={() => act(agent, "Not handed to an agent")}
					>
						Hand to an agent
					</Button>
				)}
		</>
	);
	const attention = attentionOf(cascade, ship);
	const asked =
		attention === null ? null : { attention, slug: askedSlug(cascade, ship) };
	return (
		<section aria-label="under way" className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center gap-x-2 whitespace-nowrap">
				<h2 className="font-medium text-sm">
					{running || held === undefined
						? `Shipping ${shipName(cascade.from)}`
						: `Stopped at ${held.slug}`}
				</h2>
				<span className="text-muted-foreground text-sm tabular-nums">
					{through} of {cascade.steps.length}
				</span>
				{asked === null ? null : <ChipFor tone={asked.attention.tone} />}
				<div className="ml-auto flex items-center gap-2">
					{cascade.status === "stopped" && retry !== undefined && (
						<Button
							size="xs"
							variant="outline"
							className="gap-1.5 pointer-coarse:min-h-11"
							disabled={acting || abandoning}
							onClick={() => act(retry, "Not retried")}
						>
							<RotateCcwIcon data-icon="inline-start" />
							Retry
						</Button>
					)}
					<Button
						size="xs"
						variant={live ? "destructive" : "outline"}
						className="gap-1.5 pointer-coarse:min-h-11"
						disabled={acting || abandoning}
						title={
							live ? "Ends the ship; what published stays published" : undefined
						}
						onClick={close}
					>
						<SquareIcon
							data-icon="inline-start"
							className={live ? "fill-current" : undefined}
						/>
						{live ? "Stop" : "Close"}
					</Button>
				</div>
			</div>
			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Stop this ship?</DialogTitle>
						<DialogDescription>
							What already published stays published.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirming(false)}>
							Keep going
						</Button>
						<Button variant="destructive" onClick={stop}>
							Stop
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Refusal refusal={refusals.get("") ?? null} />
			<ShipJobs
				cascade={cascade}
				ship={ship}
				live={running}
				asked={asked}
				ask={
					asked !== null ? (
						<AskCard asked={asked.attention} recovery={recovery} />
					) : null
				}
			/>
		</section>
	);
}

/**
 * The run as GitHub Actions lays out a workflow run: the projects as a list
 * of jobs on the left, and the picked one's steps and logs on the right.
 */
function ShipJobs({
	cascade,
	ship,
	live,
	asked,
	ask,
}: {
	cascade: Cascade;
	ship: Ship | null;
	live: boolean;
	asked: { attention: Attention; slug: string | null } | null;
	/** The ask to show on the step that needs it. */
	ask: ReactNode;
}): JSX.Element {
	const [picked, setPicked] = useState<string | null>(null);
	const current =
		cascade.steps.find((step) => HELD.includes(step.status)) ??
		cascade.steps.find(
			(step) => !["done", "dropped", "abandoned"].includes(step.status),
		) ??
		cascade.steps[cascade.steps.length - 1];
	const step =
		cascade.steps.find((each) => each.slug === picked) ??
		cascade.steps.find((each) => each.slug === asked?.slug) ??
		current;
	return (
		<div className="grid min-w-0 overflow-hidden rounded-lg border bg-card md:grid-cols-[14rem_minmax(0,1fr)] md:divide-x">
			<nav aria-label="Ship jobs" className="flex flex-col gap-1.5 p-2">
				<h3 className="px-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Jobs
				</h3>
				{cascade.steps.map((each) => (
					<button
						key={each.slug}
						type="button"
						aria-current={each.slug === step?.slug}
						onClick={() => setPicked(each.slug)}
						className={cn(
							"flex min-h-11 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60",
							each.slug === step?.slug && "bg-muted font-medium",
						)}
					>
						<span aria-hidden className="shrink-0">
							{ICONS[jobState(each)]}
						</span>
						<span className="min-w-0 flex-1 truncate">{each.slug}</span>
						<JobTime step={each} live={live} />
						<span
							className={cn(
								"text-xs",
								each.slug === asked?.slug
									? asked.attention.tone === "asks"
										? "font-medium text-amber-600 dark:text-amber-400"
										: "font-medium text-destructive"
									: "text-muted-foreground",
							)}
						>
							{statusLabel(each)}
						</span>
					</button>
				))}
			</nav>
			{step !== undefined && (
				<div className="min-w-0 p-4">
					<ol aria-label="Ship cascade" className="flex flex-col">
						<ProjectStage
							key={step.slug}
							cascade={cascade}
							step={step}
							ship={step.status === "shipping" ? ship : null}
							live={live}
							ask={step.slug === asked?.slug ? ask : null}
						/>
					</ol>
				</div>
			)}
		</div>
	);
}

/** Each project of `cascade` as a stage of its steps. */
export function ProjectStages({
	cascade,
	ship,
	live,
	className,
}: {
	cascade: Cascade;
	ship: Ship | null;
	/** Whether the cascade is under way, so its times run and its log is followed. */
	live: boolean;
	className?: string;
}): JSX.Element {
	return (
		<ol
			aria-label="Ship cascade"
			className={cn("flex flex-col gap-4", className)}
		>
			{cascade.steps.map((step) => (
				<ProjectStage
					key={step.slug}
					cascade={cascade}
					step={step}
					ship={step.status === "shipping" ? ship : null}
					live={live}
				/>
			))}
		</ol>
	);
}

function ProjectStage({
	cascade,
	step,
	ship,
	live,
	ask = null,
}: {
	cascade: Cascade;
	step: CascadeStep;
	ship: Ship | null;
	live: boolean;
	ask?: ReactNode;
}): JSX.Element {
	const asking = step.stages.find((stage) =>
		["asking", "failed", "hung"].includes(stage.state),
	);
	const notRun = step.status === "abandoned" && cascade.status === "stopped";
	return (
		<li
			aria-label={step.slug}
			className={cn("flex flex-col gap-3", notRun && "opacity-60")}
		>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
				<span aria-hidden className="shrink-0">
					{ICONS[jobState(step)]}
				</span>
				<span className="font-medium">{step.slug}</span>
				<span className="text-muted-foreground text-sm tabular-nums">
					{step.action === "ship" ? versionOf(step) : "takes its bump"}
				</span>
				<span
					className={cn(
						"ml-auto text-sm",
						HELD.includes(step.status)
							? "text-destructive"
							: step.status === "asking"
								? "text-amber-600 dark:text-amber-400"
								: "text-muted-foreground",
					)}
				>
					{notRun ? "not run" : statusLabel(step)}
				</span>
			</div>
			{step.task && (
				<a
					href={`?project=${encodeURIComponent(step.slug)}#todos/${encodeURIComponent(step.task)}`}
					className="text-sm underline"
				>
					Task: {step.task}
				</a>
			)}
			{step.adopt === "agent" && step.status === "bumping" && (
				<p className="text-sm text-muted-foreground">
					{step.adoptFailure
						? "Handed to an agent after the mechanical adopt failed; waiting for its task to merge."
						: "Waiting for the ship agent to adopt upstream; its task has no bump."}
				</p>
			)}
			{step.takes.map((use) => (
				<p key={use.project} className="text-muted-foreground text-sm">
					Upstream: {use.project}{" "}
					{use.pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")}
				</p>
			))}
			{step.note && (
				<p className="text-sm text-muted-foreground">{step.note}</p>
			)}
			<ol
				aria-label={`${step.slug} steps`}
				className="ml-5 flex flex-col gap-1"
			>
				{step.stages.map((stage) => (
					<Fragment key={stage.key}>
						<StageRow
							cascade={cascade}
							step={step}
							stage={stage}
							ship={ship}
							live={live}
							opened={stage.state === "failed" && cascade.status === "stopped"}
						/>
						{ask !== null && stage.key === asking?.key && (
							<li className="my-2">{ask}</li>
						)}
					</Fragment>
				))}
				{ask !== null && asking === undefined && (
					<li className="my-2">{ask}</li>
				)}
			</ol>
		</li>
	);
}

/** The statuses a project stops the run in. */
const HELD: CascadeStatus[] = ["failed", "stopped"];

/** What each status says of a project, beside it. */
function statusLabel(step: CascadeStep): string {
	return step.adopt === "agent" && step.status === "bumping"
		? "waiting for agent"
		: STATUSES[step.status];
}

const STATUSES: Record<CascadeStatus, string> = {
	waiting: "waiting",
	registry: "waiting on npm",
	bumping: "bumping",
	asking: "asks you",
	stopped: "stopped",
	shipping: "publishing",
	failed: "failed",
	done: "done",
	dropped: "dropped",
	abandoned: "abandoned",
};

/** The icon state a project's job shows: its stages' worst, else where its status stands. */
function jobState(step: CascadeStep): StageState {
	switch (step.status) {
		case "done":
			return "done";
		case "failed":
		case "stopped":
			return "failed";
		case "asking":
			return "asking";
		case "waiting":
		case "registry":
		case "bumping":
		case "shipping":
			return step.stages.some((stage) => stage.started !== null)
				? "running"
				: "pending";
		default:
			return "skipped";
	}
}

/** How long a project's job has run, from its first stage's start to its last's end. */
function JobTime({
	step,
	live,
}: {
	step: CascadeStep;
	live: boolean;
}): JSX.Element | null {
	const now = useNow(live, Duration.secs(1));
	const started = step.stages
		.map((stage) => stage.started)
		.filter((at): at is string => at !== null)
		.map((at) => Date.parse(at));
	if (started.length === 0) {
		return null;
	}
	const ended = step.stages.map((stage) => stage.ended);
	const finished = ended.every((at) => at !== null) && !live;
	const end = finished
		? Math.max(...ended.map((at) => Date.parse(at as string)))
		: now;
	return (
		<span className="text-muted-foreground text-xs tabular-nums">
			{span(end - Math.min(...started))}
		</span>
	);
}

/** The version a step goes to from where it is, or where it stays for a bump. */
export function versionOf(step: ShipStep): string {
	if (step.to === null) {
		return step.from ?? "";
	}
	return `${step.from ?? "?"} → ${step.to}`;
}

/** The project the person is asked about, or the run stopped at. */
function askedSlug(cascade: Cascade, ship: Ship | null): string | null {
	if (cascade.status === "running" && ship?.waiting != null) {
		return ship.project;
	}
	return (
		cascade.steps.find((step) =>
			["asking", "failed", "stopped"].includes(step.status),
		)?.slug ?? null
	);
}

/** The run's state as a chip beside its title, when it needs the person. */
function ChipFor({ tone }: { tone: Attention["tone"] }): JSX.Element {
	return (
		<span
			className={cn(
				"rounded-full px-2 py-0.5 font-medium text-xs",
				tone === "asks"
					? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
					: "bg-destructive/15 text-destructive",
			)}
		>
			{tone === "asks" ? "Needs you" : "Stopped"}
		</span>
	);
}

/** What the person is asked for, or why the run stopped, with the actions that answer it. */
function AskCard({
	asked,
	recovery,
}: {
	asked: Attention;
	recovery: ReactNode;
}): JSX.Element {
	const action = asked.action;
	return (
		<div
			role="status"
			className={cn(
				"flex flex-col gap-3 rounded-lg border p-4 text-sm",
				asked.tone === "asks"
					? "border-amber-500/50 bg-amber-500/10"
					: "border-destructive/50 bg-destructive/10",
			)}
		>
			<span className="font-medium">{asked.title}</span>
			{asked.detail !== null && (
				<span className="text-muted-foreground">{asked.detail}</span>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{action !== null && (
					<a
						href={action.href}
						target={action.external ? "_blank" : undefined}
						rel={action.external ? "noreferrer" : undefined}
						className={buttonVariants({ size: "sm", variant: "outline" })}
					>
						{action.label}
						{action.external && <ExternalLinkIcon />}
					</a>
				)}
				{recovery}
			</div>
		</div>
	);
}
