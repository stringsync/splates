import type { RunState } from "@splates/server/rigs/browser";
import type { JSX } from "react";
import { cn } from "./lib/utils";

const LOOKS: Record<RunState, { label: string; tone: string }> = {
	starting: { label: "Starting", tone: "bg-info/15 text-info" },
	healthy: { label: "Healthy", tone: "bg-success/15 text-success" },
	unhealthy: { label: "Unhealthy", tone: "bg-warning/20 text-warning" },
	exited: { label: "Exited", tone: "bg-destructive/12 text-destructive" },
};

/** A run's state as a dot and a word, with its exit code once it has exited. */
export function RunStatePill({
	state,
	exitCode = null,
}: {
	state: RunState;
	exitCode?: number | null;
}): JSX.Element {
	const { label, tone } = LOOKS[state];
	return (
		<span
			className={cn(
				"inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full px-2 font-medium text-xs",
				tone,
			)}
		>
			<span className="size-1.5 rounded-full bg-current" />
			{state === "exited" && exitCode !== null ? `${label} ${exitCode}` : label}
		</span>
	);
}

/** A run's state as a dot, as the Signals list marks a signal's. */
export function RunDot({ state }: { state: RunState }): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn(
				"size-2 shrink-0 rounded-full",
				state === "starting" && "bg-info ring-[3px] ring-info/25",
				state === "healthy" && "bg-success",
				state === "unhealthy" && "bg-warning ring-[3px] ring-warning/25",
				state === "exited" && "bg-destructive",
			)}
		/>
	);
}
