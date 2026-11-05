import type { JSX } from "react";

/** How many areas show before the rest are counted in one `+N`. */
const SHOWN = 3;

/**
 * The areas a task has touched, as quiet filled chips with a dot, after a
 * thin divider so they read apart from its tags. Nothing for none.
 */
export function AreaChips({
	areas,
	divided = false,
}: {
	areas: readonly string[] | undefined;
	/** Whether tags come before, so a divider sets the areas apart. */
	divided?: boolean;
}): JSX.Element | null {
	if (areas === undefined || areas.length === 0) {
		return null;
	}
	return (
		<span className="inline-flex min-w-0 flex-wrap items-center gap-1">
			{divided && <span aria-hidden className="mx-0.5 h-3 w-px bg-border" />}
			{areas.slice(0, SHOWN).map((area) => (
				<span
					key={area}
					title={`Area ${area}`}
					className="inline-flex max-w-32 items-center gap-1 truncate rounded-full bg-muted px-1.5 text-[11px] text-foreground/80 leading-4"
				>
					<span
						aria-hidden
						className="size-1 shrink-0 rounded-full bg-muted-foreground/60"
					/>
					{area}
				</span>
			))}
			{areas.length > SHOWN && (
				<span
					title={areas.slice(SHOWN).join(", ")}
					className="shrink-0 text-[11px] text-muted-foreground leading-4"
				>
					+{areas.length - SHOWN}
				</span>
			)}
		</span>
	);
}
