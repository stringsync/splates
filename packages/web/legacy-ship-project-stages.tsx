import type {
	Cascade,
	CascadeStep,
	Ship,
	Stage,
} from "@splates/server/legacy-ship";
import { Duration } from "core/time";
import { Fragment, type JSX, type ReactNode } from "react";
import { useNow } from "./hooks/use-now";
import { ShipInputSummary } from "./legacy-ship-inputs";
import {
	HELD,
	jobState,
	statusLabel,
	versionOf,
} from "./legacy-ship-job-status";
import { slowestOf } from "./legacy-ship-slow";
import { SlowBar, type SlowStage } from "./legacy-ship-slow-bar";
import { ICONS, StageRow } from "./legacy-ship-stages";
import { cn } from "./lib/utils";

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
	const { bump, ...rest } = step.inputs ?? {};
	const notRun = step.status === "abandoned" && cascade.status === "stopped";
	return (
		<li
			aria-label={step.slug}
			className={cn("flex flex-col gap-3", notRun && "opacity-60")}
		>
			<div className="flex items-center gap-x-2 text-sm">
				<span aria-hidden className="shrink-0">
					{ICONS[jobState(step)]}
				</span>
				<span className="min-w-0 truncate font-medium">{step.slug}</span>
				<span className="truncate text-muted-foreground text-sm tabular-nums">
					{step.action === "ship" ? versionOf(step) : "takes its bump"}
				</span>
				{bump !== undefined && (
					<span className="shrink-0 rounded-full bg-muted px-2 text-muted-foreground text-xs">
						{String(bump)}
					</span>
				)}
				<span
					className={cn(
						"ml-auto shrink-0 text-sm",
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
			{step.inputs !== undefined && Object.keys(rest).length > 0 && (
				<ShipInputSummary values={rest} />
			)}
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
					Waiting for the ship agent to adopt upstream; its task has no bump.
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
			<ol aria-label={`${step.slug} steps`} className="flex flex-col gap-1">
				{shownStages(cascade, step).map((stage) => (
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

/** Describe old and current runs from their recorded dependency edges. */
function shownStages(cascade: Cascade, step: CascadeStep): Stage[] {
	return step.stages.flatMap((stage) => {
		if (stage.key !== "upstream" && stage.key !== "adopt") {
			return [stage];
		}
		const uses = step.takes.filter(
			(use) =>
				stage.key === "adopt" ||
				cascade.steps.some((upstream) => upstream.slug === use.project),
		);
		if (uses.length === 0) {
			return stage.key === "adopt" && step.adopt === "agent" ? [stage] : [];
		}
		const names = uses
			.map((use) => {
				const upstream = cascade.steps.find(
					(each) => each.slug === use.project,
				);
				return use.pins.length > 0 && upstream?.to != null
					? use.pins.map((pin) => `${pin.name} ${upstream.to}`).join(", ")
					: use.project;
			})
			.join(", ");
		const npm = uses.every(
			(use) =>
				use.pins.length > 0 &&
				cascade.steps.find((each) => each.slug === use.project)?.to != null,
		);
		return [
			{
				...stage,
				name:
					stage.key === "upstream"
						? `Wait for ${names}${npm ? " on npm" : " live"}`
						: `Update to ${names}`,
			},
		];
	});
}
