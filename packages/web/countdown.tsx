import { type JSX, type ReactNode, useEffect, useState } from "react";
import type { Duration } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { WAITS } from "./api";

/**
 * How long until a wait that has run on gives up, shown once the first third
 * of it has passed quietly, so a quick answer never flashes it. What waits
 * says the rest: that it gave up, and why. Still, in words, unless given the
 * page's one spinner, which only `GivingUp` carries.
 */
export function Countdown({
	givesUpAt,
	waitsMs,
	doing = "loading",
	spinner,
	className,
}: {
	/** When the wait gives up, in `Date.now()` ms, or null while nothing waits. */
	givesUpAt: number | null;
	/** How long the wait is in all, in ms. */
	waitsMs: number;
	/** What is still under way, as in "Still loading". */
	doing?: string;
	/** Drawn before the words. */
	spinner?: ReactNode;
	className?: string;
}): JSX.Element | null {
	const now = useTicking(givesUpAt !== null);
	if (givesUpAt === null || givesUpAt - now > waitsMs * (1 - QUIET_SHARE)) {
		return null;
	}
	return (
		<span
			role="status"
			className={cn(
				"fade-in-0 flex shrink-0 animate-in items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs duration-300",
				className,
			)}
		>
			{spinner}
			Still {doing}, gives up in {left(givesUpAt - now)}
		</span>
	);
}

/**
 * `Countdown` for a wait on one request, counted from when it shows: put it
 * beside a placeholder or a spinner for as long as the request is on its
 * way, and the request's own timeout (`within`, `WAITS.answer` unless given)
 * ends both together.
 */
export function StillWaiting({
	within,
	doing,
	className,
}: {
	within?: Duration;
	doing?: string;
	className?: string;
}): JSX.Element | null {
	const waitsMs = (within ?? WAITS.answer).ms;
	const [givesUpAt] = useState(() => Date.now() + waitsMs);
	return (
		<Countdown
			givesUpAt={givesUpAt}
			waitsMs={waitsMs}
			doing={doing}
			className={className}
		/>
	);
}

// The share of the wait that passes quietly before the countdown shows.
const QUIET_SHARE = 1 / 3;

/** `ms` as the countdown says it: seconds, or whole minutes from two on. */
function left(ms: number): string {
	const seconds = Math.max(1, Math.ceil(ms / 1000));
	return seconds >= 120 ? `${Math.ceil(seconds / 60)}m` : `${seconds}s`;
}

/** `Date.now()`, read again every quarter second while `ticking`. */
function useTicking(ticking: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) {
			return;
		}
		setNow(Date.now());
		const ticks = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(ticks);
	}, [ticking]);
	return now;
}

/**
 * What a page shows while it reads: `label`, then `StillWaiting` beside it
 * once the read has run on, until the read answers or gives up.
 */
export function ReadingNow({ label }: { label: string }): JSX.Element {
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<p role="status" className="text-muted-foreground text-sm">
				{label}
			</p>
			<StillWaiting />
		</div>
	);
}

/**
 * Why a read failed, timed out included, with Try again when it can be read
 * afresh; what the page shows besides stays, to be read and copied.
 */
export function ReadFailed({
	error,
	onRetry,
}: {
	error: string;
	/** Reads again; no Try again without it. */
	onRetry?: () => void;
}): JSX.Element {
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<p role="alert" className="text-destructive text-sm">
				{error}
			</p>
			{onRetry && (
				<Button variant="outline" size="sm" onClick={onRetry}>
					Try again
				</Button>
			)}
		</div>
	);
}

/**
 * For a wait the page cannot end itself, as on a server coming back from a
 * restart: `Countdown` through its last two thirds, then `gaveUp` as an
 * error, saying the wait ran past what it should take while the page goes
 * on trying behind it.
 */
export function TakingLong({
	within,
	doing,
	gaveUp,
}: {
	within: Duration;
	doing: string;
	/** What it says once the wait ran past `within`, with any way out of it. */
	gaveUp: ReactNode;
}): JSX.Element | null {
	const [givesUpAt] = useState(() => Date.now() + within.ms);
	const now = useTicking(true);
	if (now < givesUpAt) {
		return (
			<Countdown givesUpAt={givesUpAt} waitsMs={within.ms} doing={doing} />
		);
	}
	return (
		<div
			role="alert"
			className="flex flex-wrap items-center gap-x-3 gap-y-1 text-destructive text-sm"
		>
			{gaveUp}
		</div>
	);
}
