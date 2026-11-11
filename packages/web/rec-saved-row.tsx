import type { RecState } from "@splates/server/rec/browser";
import { Check, Copy } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "./components/ui/button";

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
				<CopyReference name={outcome.name} />
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

/** Copies the `#rec:<name>` reference that points an agent at the saved session. */
function CopyReference({ name }: { name: string }): JSX.Element {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="ml-auto"
			onClick={() => {
				void navigator.clipboard.writeText(`#rec:${name}`).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				});
			}}
		>
			{copied ? <Check /> : <Copy />}
			{copied ? "Copied" : "Copy reference"}
		</Button>
	);
}
