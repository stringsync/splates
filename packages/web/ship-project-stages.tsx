import type { Cascade, CascadeStep, Ship } from "@splates/server/ship";
import { Duration } from "core/time";
import { Fragment, type JSX, type ReactNode } from "react";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { HELD, jobState, statusLabel, versionOf } from "./ship-job-status";
import { slowestOf } from "./ship-slow";
import { SlowBar, type SlowStage } from "./ship-slow-bar";
import { ICONS, StageRow } from "./ship-stages";

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

export function ProjectStage({
	cascade,
	step,
	ship,
	live,
	ask = null,
	sendSlow,
}: {
	cascade: Cascade;
	step: CascadeStep;
	ship: Ship | null;
	live: boolean;
	ask?: ReactNode;
	sendSlow?: (slow: SlowStage) => void;
}): JSX.Element {
	const now = useNow(live, Duration.secs(1));
	const slow = live && sendSlow !== undefined ? slowestOf(step, now) : null;
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
			{slow !== null && sendSlow !== undefined && (
				<SlowBar
					cascade={cascade.id}
					project={step.slug}
					slow={slow}
					now={now}
					send={sendSlow}
				/>
			)}
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
