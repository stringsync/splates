import { CheckIcon, CopyIcon } from "lucide-react";
import { createContext, type JSX, type ReactNode, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/** Whether the fenced code blocks below it carry a Copy button. */
export const CopyableCode = createContext(false);

/** How long the button says it copied before it goes back. */
const COPIED_MS = 1500;

/**
 * A fenced code block with a Copy button beside it, so a command can be
 * pasted into a terminal. Wrap the `<pre>` in it, with no background of its
 * own, and pass the text to copy.
 */
export function CopyablePre({
	text,
	children,
}: {
	/** What Copy puts on the clipboard. */
	text: string;
	children: ReactNode;
}): JSX.Element {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	const label =
		state === "copied" ? "Copied" : state === "failed" ? "Not copied" : "Copy";
	return (
		// The button keeps a column of its own: a long line scrolls beside it, never under it.
		<div className="group/code my-2 flex items-start rounded bg-current/8">
			{children}
			<button
				type="button"
				aria-label={`${label} command`}
				title={label}
				onClick={(event) => {
					// A pop-out is another window, and only its own clipboard accepts a write there.
					const clipboard = (
						event.currentTarget.ownerDocument.defaultView ?? window
					).navigator.clipboard;
					const settle = (next: "copied" | "failed") => {
						setState(next);
						setTimeout(() => setState("idle"), COPIED_MS);
					};
					void clipboard.writeText(text).then(
						() => settle("copied"),
						() => settle("failed"),
					);
				}}
				className={cn(
					"m-1.5 grid size-6 shrink-0 place-items-center rounded border bg-background/90 text-muted-foreground opacity-70 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 group-hover/code:opacity-100",
					state === "copied" && "text-success opacity-100",
				)}
			>
				{state === "copied" ? (
					<CheckIcon className="size-3.5" />
				) : (
					<CopyIcon className="size-3.5" />
				)}
			</button>
		</div>
	);
}
