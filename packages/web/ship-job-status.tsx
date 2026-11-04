import type {
	Cascade,
	CascadeStatus,
	CascadeStep,
	Ship,
	ShipStep,
	StageState,
} from "@splates/server/ship";
import { Duration } from "core/time";
import { ExternalLinkIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import type { Attention } from "./ship-dock";
import { span } from "./ship-stages";

/** The statuses a project stops the run in. */
export const HELD: CascadeStatus[] = ["failed", "stopped"];

/** What each status says of a project, beside it. */
export function statusLabel(step: CascadeStep): string {
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
export function jobState(step: CascadeStep): StageState {
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
export function JobTime({
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
export function askedSlug(cascade: Cascade, ship: Ship | null): string | null {
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
export function ChipFor({ tone }: { tone: Attention["tone"] }): JSX.Element {
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
export function AskCard({
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
