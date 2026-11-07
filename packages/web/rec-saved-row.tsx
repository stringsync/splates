import type { RecState } from "@splates/server/rec/browser";
import type { JSX } from "react";

export type LastOutcome = NonNullable<RecState["status"]["lastOutcome"]>;

/** Says how the last recording ended: a link to the saved session, or why it was not saved. */
export function SavedRow({ outcome }: { outcome: LastOutcome }): JSX.Element {
	if (outcome.status === "saved") {
		return (
			<div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
				<span className="font-medium">Saved</span>
				<a
					className="truncate font-mono text-xs underline"
					href={`#rec/${encodeURIComponent(outcome.name)}`}
				>
					{outcome.name}
				</a>
			</div>
		);
	}
	return (
		<div
			role="alert"
			className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
		>
			<span className="font-medium">Not saved</span>
			<span className="text-destructive text-xs">{outcome.reason}</span>
		</div>
	);
}
