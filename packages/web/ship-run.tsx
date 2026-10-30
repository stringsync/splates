import type {
	Cascade,
	CascadeStatus,
	CascadeStep,
	Ship,
	ShipStep,
} from "@stringsync/splates-server/ship";
import { shipName } from "@stringsync/splates-server/ship/browser";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "./lib/utils";
import { askMachineNow } from "./machine";
import { Refusal, useRefusals } from "./refusal";
import { StageRow } from "./ship-stages";
import { ShipStatusCard } from "./ship-status-card";

/**
 * A ship under way, or one that stopped: a stage per project in the order
 * they go, every step of each checked off as it ends, and what waits on the
 * person, or why it stopped, in the dock beneath them. Abandon ends a run
 * under way; Close puts away one that stopped.
 */
export function ShipRun({
	cascade,
	ship,
	onClose,
	abandon: abandonRun,
	retry,
	agent,
}: {
	cascade: Cascade;
	ship: Ship | null;
	/** Ends the run; the cascade alone by default, the run and its conversation when it has one. */
	abandon?: () => Promise<void>;
	retry?: () => Promise<void>;
	agent?: () => Promise<void>;
	/** Puts away a run that stopped. */
	onClose: () => void;
}): JSX.Element {
	const { refusals, refuse } = useRefusals<string>();
	const [abandoning, setAbandoning] = useState(false);
	const [acting, setActing] = useState(false);
	const act = (run: () => Promise<void>, title: string) => {
		setActing(true);
		run()
			.then(askMachineNow, (error: unknown) => refuse("", title, error))
			.finally(() => setActing(false));
	};
	const running = cascade.status === "running";
	const held = cascade.steps.find((step) => HELD.includes(step.status));
	const abandon = () => {
		if (abandonRun === undefined) {
			return;
		}
		setAbandoning(true);
		abandonRun().then(askMachineNow, (error: unknown) => {
			setAbandoning(false);
			refuse("", "Not abandoned", error);
		});
	};
	const through = cascade.steps.filter(
		(step) => step.status === "done" || step.status === "dropped",
	).length;
	return (
		<section aria-label="under way" className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-x-2 whitespace-nowrap">
				<h2 className="font-medium text-sm">
					{running || held === undefined
						? `Shipping ${shipName(cascade.from)}`
						: `Stopped at ${held.slug}`}
				</h2>
				<span className="text-muted-foreground text-sm tabular-nums">
					{through} of {cascade.steps.length}
				</span>
				{cascade.status === "stopped" && retry !== undefined && (
					<Button
						size="sm"
						className="min-h-11"
						variant="outline"
						disabled={acting || abandoning}
						onClick={() => act(retry, "Not retried")}
					>
						Retry
					</Button>
				)}
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
							className="min-h-11"
							variant="outline"
							disabled={acting || abandoning}
							onClick={() => act(agent, "Not handed to an agent")}
						>
							Hand to an agent
						</Button>
					)}
				{running || cascade.status === "stopped" ? (
					<Button
						size="xs"
						variant="ghost"
						className="ml-auto min-h-11"
						disabled={acting || abandoning || abandonRun === undefined}
						title="Ends the ship; what published stays published"
						onClick={abandon}
					>
						Abandon
					</Button>
				) : (
					<Button
						size="xs"
						variant="ghost"
						className="ml-auto min-h-11"
						onClick={onClose}
					>
						Close
					</Button>
				)}
			</div>
			<Refusal refusal={refusals.get("") ?? null} />
			<ShipStatusCard cascade={cascade} ship={ship} />
			<ShipJobs cascade={cascade} ship={ship} live={running} />
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
}: {
	cascade: Cascade;
	ship: Ship | null;
	live: boolean;
}): JSX.Element {
	const [picked, setPicked] = useState<string | null>(null);
	const current =
		cascade.steps.find((step) => HELD.includes(step.status)) ??
		cascade.steps.find(
			(step) => !["done", "dropped", "abandoned"].includes(step.status),
		) ??
		cascade.steps[cascade.steps.length - 1];
	const step = cascade.steps.find((each) => each.slug === picked) ?? current;
	return (
		<div className="grid min-w-0 gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
			<nav aria-label="Ship jobs" className="flex flex-col gap-1">
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
						<span
							aria-hidden
							className={cn(
								"size-2.5 shrink-0 rounded-full",
								DOTS[each.status],
							)}
						/>
						<span className="min-w-0 flex-1 truncate">{each.slug}</span>
						<span className="text-muted-foreground text-xs">
							{STATUSES[each.status]}
						</span>
					</button>
				))}
			</nav>
			{step !== undefined && (
				<div className="min-w-0 rounded-lg border bg-card p-4">
					<ol aria-label="Ship cascade" className="flex flex-col">
						<ProjectStage
							key={step.slug}
							cascade={cascade}
							step={step}
							ship={step.status === "shipping" ? ship : null}
							live={live}
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
}: {
	cascade: Cascade;
	step: CascadeStep;
	ship: Ship | null;
	live: boolean;
}): JSX.Element {
	const notRun = step.status === "abandoned" && cascade.status === "stopped";
	return (
		<li
			aria-label={step.slug}
			className={cn("flex flex-col gap-1", notRun && "opacity-60")}
		>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
				<span
					aria-hidden
					className={cn("size-2 shrink-0 rounded-full", DOTS[step.status])}
				/>
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
					{notRun ? "not run" : STATUSES[step.status]}
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
			{step.takes.map((use) => (
				<p key={use.project} className="text-muted-foreground text-sm">
					Upstream: {use.project}{" "}
					{use.pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")}
				</p>
			))}
			{step.note && (
				<p className="text-sm text-muted-foreground">{step.note}</p>
			)}
			<ol aria-label={`${step.slug} steps`} className="ml-4 flex flex-col">
				{step.stages.map((stage) => (
					<StageRow
						key={stage.key}
						cascade={cascade}
						step={step}
						stage={stage}
						ship={ship}
						live={live}
						opened={stage.state === "failed" && cascade.status === "stopped"}
					/>
				))}
			</ol>
		</li>
	);
}

/** The statuses a project stops the run in. */
const HELD: CascadeStatus[] = ["failed", "stopped"];

/** What each status says of a project, beside it. */
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

const DOTS: Record<CascadeStatus, string> = {
	waiting: "bg-muted-foreground/40",
	registry: "bg-amber-500",
	bumping: "bg-info",
	asking: "bg-amber-500",
	stopped: "bg-destructive",
	shipping: "bg-info",
	failed: "bg-destructive",
	done: "bg-emerald-500",
	dropped: "bg-muted-foreground/40",
	abandoned: "bg-muted-foreground/40",
};

/** The version a step goes to from where it is, or where it stays for a bump. */
export function versionOf(step: ShipStep): string {
	if (step.to === null) {
		return step.from ?? "";
	}
	return `${step.from ?? "?"} → ${step.to}`;
}
