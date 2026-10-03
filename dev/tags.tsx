import { TagIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";

/**
 * A row of tags over the list, the way a mail client filters by label: All,
 * then every tag a todo has. Tapping one shows only its todos.
 */
export function TagFilter({
	tags,
	selected,
	onSelect,
}: {
	tags: string[];
	selected: string | null;
	onSelect: (tag: string | null) => void;
}): JSX.Element {
	const chip = (label: string, value: string | null) => (
		<button
			key={label}
			type="button"
			aria-pressed={selected === value}
			onClick={() => onSelect(value)}
			className={cn(
				"inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
				selected === value
					? "border-primary bg-primary text-primary-foreground"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			{value !== null && <TagIcon aria-hidden className="size-3" />}
			{label}
		</button>
	);
	return (
		<fieldset
			aria-label="filter by tag"
			className="m-0 flex flex-wrap gap-1.5 border-0 p-0"
		>
			{chip("All", null)}
			{tags.map((tag) => chip(tag, tag))}
		</fieldset>
	);
}
