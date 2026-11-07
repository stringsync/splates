import { ChevronRightIcon, HistoryIcon } from "lucide-react";
import type { JSX } from "react";

/**
 * The way from a planner to its past runs: one quiet row in the page, with a
 * line on what history holds, so the planner stays the first thing on it.
 */
export function HistoryRow({
	href,
	summary,
}: {
	href: string;
	/** Such as "Last shipped 1d ago"; null while it is read or when there is nothing to say. */
	summary: string | null;
}): JSX.Element {
	return (
		<a
			href={href}
			className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-sm hover:bg-accent/50"
		>
			<HistoryIcon aria-hidden className="size-4 text-muted-foreground" />
			<span>History</span>
			{summary !== null && (
				<span className="truncate text-muted-foreground text-xs">
					{summary}
				</span>
			)}
			<ChevronRightIcon
				aria-hidden
				className="ml-auto size-3.5 shrink-0 text-muted-foreground"
			/>
		</a>
	);
}

/** How wide a planner page grows on a large screen: the phone layout, in a column. */
export const PLANNER_COLUMN = "mx-auto flex w-full max-w-2xl min-w-0 flex-col";
