import type {
	Cascade,
	CascadeStatus,
	CascadeStep,
	Ship,
} from "@stringsync/splates-server/ship";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { abandonCascade } from "./api";
import { cn } from "./lib/utils";
import { askMachineNow } from "./machine";
import { Refusal, useRefusals } from "./refusal";
import { versionOf } from "./ship-dialog";
import { ShipDock } from "./ship-dock";
import { StageRow } from "./ship-stages";

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
}: {
	cascade: Cascade;
	ship: Ship | null;
	/** Puts away a run that stopped. */
	onClose: () => void;
}): JSX.Element {
	const { refusals, refuse } = useRefusals<string>();
	const [abandoning, setAbandoning] = useState(false);
	const running = cascade.status === "running";
	const held = cascade.steps.find((step) => HELD.includes(step.status));
	const abandon = () => {
		setAbandoning(true);
		abandonCascade().then(askMachineNow, (error: unknown) => {
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
						? `Shipping ${cascade.from}`
						: `Stopped at ${held.slug}`}
				</h2>
				<span className="text-muted-foreground text-xs tabular-nums">
					{through} of {cascade.steps.length}
				</span>
				{running ? (
					<Button
						size="xs"
						variant="ghost"
						className="ml-auto"
						disabled={abandoning}
						title="Ends the run, stopping its ship and removing its open bump tasks; what shipped stays shipped"
						onClick={abandon}
					>
						Abandon
					</Button>
				) : (
					<Button
						size="xs"
						variant="ghost"
						className="ml-auto"
						onClick={onClose}
					>
						Close
					</Button>
				)}
			</div>
			<Refusal refusal={refusals.get("") ?? null} />
			<ProjectStages cascade={cascade} ship={ship} live={running} />
			<ShipDock cascade={cascade} ship={ship} />
		</section>
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
				<span className="text-muted-foreground text-xs tabular-nums">
					{step.action === "ship" ? versionOf(step) : "takes its bump"}
				</span>
				<span
					className={cn(
						"ml-auto text-xs",
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
