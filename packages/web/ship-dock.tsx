import type { Cascade, Ship } from "@stringsync/splates-server/ship";
import { todoAddress } from "./page-address";

/** One thing the person is asked for, or told of. */
export interface Attention {
	/** `asks` while the ship waits on them, `stopped` once it stopped. */
	tone: "asks" | "stopped";
	title: string;
	detail: string | null;
	action: { label: string; href: string; external: boolean } | null;
}

/** A link in a note, such as npm's settings a stopped ship names. */
const LINK = /https?:\/\/[^\s,]+/;

/**
 * What `cascade` waits on the person for first, or why it stopped: npm's
 * sign-in or second factor, a bump task's question, or the project it
 * stopped at; null while it goes on its own.
 */
export function attentionOf(
	cascade: Cascade,
	ship: Ship | null,
): Attention | null {
	if (cascade.status === "running" && ship?.waiting != null) {
		return {
			tone: "asks",
			title:
				ship.waiting.kind === "login"
					? "Sign in to npm"
					: `Approve ${ship.project} on npm`,
			detail:
				ship.waiting.kind === "login"
					? "npm waits for you to sign in on its page."
					: "npm holds the publish until you confirm it on its page.",
			action: { label: "Open npm", href: ship.waiting.url, external: true },
		};
	}
	const asking = cascade.steps.find((step) => step.status === "asking");
	if (cascade.status === "running" && asking !== undefined) {
		const project = new URLSearchParams({ project: asking.slug });
		return {
			tone: "asks",
			title: `${asking.slug}'s bump task asks you something`,
			detail: null,
			action:
				asking.task === null
					? null
					: {
							label: `Answer #${asking.task}`,
							href: `?${project}${todoAddress(asking.task)}`,
							external: false,
						},
		};
	}
	const held = cascade.steps.find(
		(step) => step.status === "failed" || step.status === "stopped",
	);
	if (cascade.status !== "stopped" || held === undefined) {
		return null;
	}
	const failed = held.stages.find((stage) => stage.state === "failed");
	const link = held.note === null ? null : LINK.exec(held.note)?.[0];
	return {
		tone: "stopped",
		title:
			held.status === "stopped"
				? `${held.slug}'s bump task was removed`
				: `${held.slug}: ${failed?.name ?? "its ship"} failed`,
		detail:
			held.note?.replace(/\s+at\s+https?:\/\/[^\s,]+,?/, "").trim() ?? null,
		action:
			link == null
				? null
				: { label: "Open npm settings", href: link, external: true },
	};
}
