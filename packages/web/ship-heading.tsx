import type { JSX, ReactNode } from "react";

/**
 * Heads a Ships screen with `title`, an instruction or where the ship
 * stands, after an optional `icon`, with an optional muted `line` under it.
 */
export function ShipHeading({
	icon,
	title,
	line,
}: {
	icon?: ReactNode;
	title: string;
	line?: ReactNode;
}): JSX.Element {
	// The icon keeps to the first line when the words wrap on a phone, and
	// the words break in balanced lines, never inside a span of time.
	return (
		<div className="flex flex-col gap-1">
			<h2 className="flex items-start gap-2 text-balance font-medium text-lg leading-snug">
				{icon !== undefined && (
					<span className="flex h-[1.375em] shrink-0 items-center">{icon}</span>
				)}
				<span className="min-w-0">{unbroken(title)}</span>
			</h2>
			{line !== undefined && (
				<p className="text-pretty text-muted-foreground text-sm">
					{typeof line === "string" ? unbroken(line) : line}
				</p>
			)}
		</div>
	);
}

/** Returns `words` with each span of time, as "1m 53s", kept on one line. */
export function unbroken(words: string): string {
	return words.replace(/(\d+[hms]) (?=\d+[ms]\b)/g, "$1 ");
}
