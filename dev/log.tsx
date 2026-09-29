import type { JSX } from "react";
import { age } from "../age";
import type { Entry } from "../journal";

/** What was done here, newest first: the page is read to see what just happened. */
export function Log({ entries }: { entries: Entry[] }): JSX.Element {
	if (entries.length === 0) {
		return <p className="text-muted-foreground text-sm">Nothing yet.</p>;
	}
	return (
		<ul className="flex flex-col gap-1 text-sm">
			{entries.toReversed().map((entry) => (
				<li
					key={`${entry.at}-${entry.action}-${entry.task ?? ""}`}
					className="flex items-baseline gap-3"
				>
					<span className="w-8 shrink-0 text-muted-foreground text-xs tabular-nums">
						{age(entry.at)}
					</span>
					<span className="min-w-0 flex-1 truncate">
						{entry.action}
						{entry.task ? (
							<span className="text-muted-foreground"> {entry.task}</span>
						) : null}
					</span>
					{/* Success is the normal case and goes unsaid. */}
					{entry.reason !== null && (
						<span className="shrink-0 text-destructive text-xs">
							{entry.reason}
						</span>
					)}
				</li>
			))}
		</ul>
	);
}
