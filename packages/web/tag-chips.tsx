import { createContext, type JSX, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import type { TaskFilter } from "./task-filter";

/** The filter a modifier-click on a tag chip sets, on the pages that have one. */
export const TagFilterContext = createContext<TaskFilter | null>(null);

/** The color each tag's chips take, by tag, from `splates.config.ts`. */
export const TagColorsContext = createContext<
	Readonly<Record<string, string>> | undefined
>(undefined);

/** The chip classes of each color a config may name, light and dark. */
const COLORS: Readonly<Record<string, string>> = {
	red: "border-transparent bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
	orange:
		"border-transparent bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
	amber:
		"border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
	green:
		"border-transparent bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
	teal: "border-transparent bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300",
	blue: "border-transparent bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
	indigo:
		"border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
	violet:
		"border-transparent bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
	pink: "border-transparent bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300",
	gray: "border-transparent bg-zinc-200 text-zinc-700 dark:bg-zinc-500/25 dark:text-zinc-300",
};

/** What a click on a chip holds to narrow the board by its tag. */
const FILTER_KEY = "Ctrl/\u2318";

/** Whether `event` is a click that narrows the board, not an ordinary one. */
export function filtersOnClick(event: {
	metaKey: boolean;
	ctrlKey: boolean;
}): boolean {
	return event.metaKey || event.ctrlKey;
}

const PLAIN = "border-border/60 text-muted-foreground";

/**
 * A task's tags as quiet chips, one per tag in alphabetical order so they
 * read the same everywhere; nothing for a task with none.
 */
export function TagChips({
	tags,
	className,
	max,
}: {
	tags: readonly string[] | undefined;
	className?: string;
	/** Past this many, the rest are counted in one chip, as `+3`, for a row with no room to wrap. */
	max?: number;
}): JSX.Element | null {
	const filter = useContext(TagFilterContext);
	const colors = useContext(TagColorsContext);
	if (tags === undefined || tags.length === 0) {
		return null;
	}
	return (
		<span
			className={cn(
				"inline-flex min-w-0 flex-wrap items-center gap-1",
				className,
			)}
		>
			{[...tags]
				.sort()
				.slice(0, max)
				.map((tag) => {
					const chip = cn(
						"max-w-32 truncate rounded border px-1 text-[11px] leading-4",
						COLORS[colors?.[tag] ?? ""] ?? PLAIN,
					);
					return filter === null ? (
						<span key={tag} title={`Tag ${tag}`} className={chip}>
							{tag}
						</span>
					) : (
						<button
							key={tag}
							type="button"
							title={`Filter by ${tag} (${FILTER_KEY}-click)`}
							aria-pressed={filter.tags.includes(tag)}
							className={cn(
								chip,
								"hover:bg-accent aria-pressed:bg-accent aria-pressed:text-foreground",
							)}
							onClick={(event) => {
								// A plain click is no choice to narrow the board, which a
								// stray one left kept and hiding every other task; it goes
								// on to whatever the chip sits in, as a click beside it does.
								if (!filtersOnClick(event)) {
									return;
								}
								event.stopPropagation();
								filter.toggleTag(tag);
							}}
						>
							{tag}
						</button>
					);
				})}
			{max !== undefined && tags.length > max && (
				<span
					title={[...tags].sort().slice(max).join(", ")}
					className={cn(
						"shrink-0 text-[11px] leading-4",
						"text-muted-foreground",
					)}
				>
					+{tags.length - max}
				</span>
			)}
		</span>
	);
}
