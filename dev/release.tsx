import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { Behind, Release } from "../release";
import type { Projects } from "./project-api";

/** The short form of a commit, as git prints it. */
export function short(commit: string): string {
	return commit.slice(0, 8);
}

/**
 * What a restart now would bring, or null when `arbor dev` is up to date: its
 * source commit from a checkout, else the newest npm release. Every place that
 * names where a restart lands says it this way.
 */
export function ontoOf(
	listed: Pick<Projects, "behind" | "newest">,
): string | null {
	return listed.behind !== null
		? short(listed.behind.newest)
		: listed.newest !== null
			? `arbor ${listed.newest}`
			: null;
}

/** What a restart would update to, or null when nothing newer is out. */
export function update(
	release: Release | null,
	behind: Behind | null,
): string | null {
	if (behind !== null) {
		return `arbor's source is at ${short(behind.newest)} (this runs ${short(behind.running)})`;
	}
	if (release !== null) {
		return `arbor ${release.newest} is out (this runs ${release.running})`;
	}
	return null;
}

/**
 * A dot over a control's icon, saying a restart would update. Ringed in what
 * it sits on, `ring` by default the page's background.
 */
export function UpdateDot({
	ring = "ring-background",
}: {
	ring?: string;
}): JSX.Element {
	return (
		<span
			className={cn(
				"-top-0.5 -right-0.5 absolute size-2 rounded-full bg-warning ring-2",
				ring,
			)}
		/>
	);
}

/** What Restart needs: each set only when a restart would update. */
export interface Update {
	release: Release | null;
	behind: Behind | null;
}
