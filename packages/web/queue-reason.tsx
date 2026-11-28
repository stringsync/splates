import { InfoIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

const REASON = /^\s*why not auto-queued:\s*(.+?)\s*$/i;

/**
 * A queue card's text split into the line saying why the agent could not
 * queue it itself, when it has one, and the rest.
 */
export function reasonOf(body: string): {
	reason: string | null;
	rest: string;
} {
	const rows = body.split("\n");
	const at = rows.findIndex((each) => REASON.test(each));
	if (at < 0) {
		return { reason: null, rest: body };
	}
	const reason = REASON.exec(rows[at] as string)?.[1] as string;
	return {
		reason: reason.charAt(0).toUpperCase() + reason.slice(1),
		rest: rows
			.filter((_, index) => index !== at)
			.join("\n")
			.replace(/^\n+|\s+$/g, ""),
	};
}

/** Why the agent could not queue the work itself, as a notice at the card's top. */
export function ReasonNotice({
	reason,
	last,
}: {
	reason: string;
	/** Whether nothing follows it above the card's panel, so it keeps its own bottom space. */
	last: boolean;
}): JSX.Element {
	return (
		<div
			className={cn(
				"px-4 pt-3.5 @max-md:pt-2.5",
				last && "pb-3.5 @max-md:pb-2.5",
			)}
		>
			<aside
				aria-label="why not auto-queued"
				className="rounded-lg bg-muted px-3 py-2.5"
			>
				<div className="flex items-center gap-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
					<InfoIcon className="size-3.5" />
					Why not auto-queued
				</div>
				<p className="mt-0.5 text-sm leading-relaxed">{reason}</p>
			</aside>
		</div>
	);
}
