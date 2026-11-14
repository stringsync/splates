import type { EvalGrid } from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";

/** `Date.now()` that updates every second while `ticking`, so a timer can show it. */
export function useSecondClock(ticking: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) {
			return;
		}
		setNow(Date.now());
		const ticks = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(ticks);
	}, [ticking]);
	return now;
}

/** How long a batch has taken, in ms: what the run card shows as its time elapsed. */
export function elapsedMs(
	grid: EvalGrid,
	running: boolean,
	now: number,
): number {
	// The batch keeps no end time, so a finished one is the longest any agent spent on its runs.
	if (running) {
		return Math.max(0, now - new Date(grid.startedAt).getTime());
	}
	const spent = new Map<string, number>();
	for (const cell of grid.grid) {
		spent.set(
			cell.target,
			(spent.get(cell.target) ?? 0) + (cell.run?.milliseconds ?? 0),
		);
	}
	return Math.max(0, ...spent.values());
}

/** `42s`, `3m 05s` or `1h 02m 05s`. */
export function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const two = (value: number): string => String(value).padStart(2, "0");
	if (hours > 0) {
		return `${hours}h ${two(minutes)}m ${two(seconds)}s`;
	}
	return minutes > 0 ? `${minutes}m ${two(seconds)}s` : `${seconds}s`;
}

/** The running card's header timer. */
export function EvalTimer({ grid }: { grid: EvalGrid }): JSX.Element {
	const now = useSecondClock(true);
	return (
		<span
			role="timer"
			aria-label="time elapsed"
			data-testid="eval-timer"
			className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums"
		>
			{formatElapsed(elapsedMs(grid, true, now))}
		</span>
	);
}
