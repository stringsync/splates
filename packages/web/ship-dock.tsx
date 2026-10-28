import type { Cascade, Ship } from "@stringsync/splates-server/ship";
import { ExternalLinkIcon } from "lucide-react";
import type { JSX } from "react";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "./lib/utils";
import { todoAddress } from "./page-address";

/**
 * What the ship waits on the person for, or why it stopped, pinned beneath
 * its steps: one thing at a time, with the one action that answers it.
 * Nothing while the ship goes on its own.
 */
export function ShipDock({
	cascade,
	ship,
}: {
	cascade: Cascade;
	ship: Ship | null;
}): JSX.Element | null {
	const attention = attentionOf(cascade, ship);
	if (attention === null) {
		return null;
	}
	// Dressed as the conversation's composer is, on the page's own background,
	// so it reads as the page's in light and dark alike.
	return (
		<div
			role="status"
			aria-label="needs you"
			className="sticky bottom-0 z-10 mt-2 bg-background pt-2 pb-2"
		>
			<div className="flex flex-col gap-1 rounded-lg border border-foreground/10 bg-[color-mix(in_oklab,var(--color-muted)_30%,transparent)] px-4 py-2.5">
				<div className="flex items-center gap-2">
					<span
						aria-hidden
						className={cn(
							"size-2 shrink-0 rounded-full",
							attention.tone === "asks" ? "bg-amber-500" : "bg-destructive",
						)}
					/>
					<span className="min-w-0 flex-1 font-medium text-sm">
						{attention.title}
					</span>
					{attention.action !== null && (
						<a
							href={attention.action.href}
							target={attention.action.external ? "_blank" : undefined}
							rel={attention.action.external ? "noreferrer" : undefined}
							className={cn(
								buttonVariants({
									size: "sm",
									variant: attention.tone === "asks" ? "default" : "outline",
								}),
								"shrink-0",
							)}
						>
							{attention.action.label}
							{attention.action.external && <ExternalLinkIcon />}
						</a>
					)}
				</div>
				{attention.detail !== null && (
					// Its own line beneath, the width of the bar, so a long
					// button never squeezes it into a column.
					<span className="pr-1 pb-0.5 pl-4 text-foreground/55 text-xs">
						{attention.detail}
					</span>
				)}
			</div>
		</div>
	);
}

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
