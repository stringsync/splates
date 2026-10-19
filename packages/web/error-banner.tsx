import type { ConversationState } from "@stringsync/splates-server/conversations";
import { CircleAlertIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * Under a conversation's header once its agent or its last turn failed,
 * across the pane's padding to its edges: what stopped, how to carry on, and
 * the agent's own words, cut to a few lines until tapped.
 */
export function ErrorBanner({
	conversation,
	error,
	phone,
}: {
	conversation: ConversationState;
	error: string;
	phone: boolean;
}): JSX.Element {
	const [whole, setWhole] = useState(false);
	const stopped = conversation.status === "failed";
	return (
		<div
			role="alert"
			className={cn(
				bleed(phone),
				"flex shrink-0 gap-2.5 border-destructive/30 border-y bg-destructive/10 px-4 py-2.5 text-sm",
			)}
		>
			<CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p>
					<span className="font-medium text-destructive">
						{stopped ? "The agent stopped." : "The last turn failed."}
					</span>{" "}
					<span className="text-muted-foreground">
						{stopped
							? "Send a message to start it again."
							: "Send a message to try again."}
					</span>
				</p>
				<button
					type="button"
					aria-expanded={whole}
					onClick={() => setWhole(!whole)}
					className={cn(
						"whitespace-pre-wrap break-words text-left font-mono text-muted-foreground text-xs",
						!whole && "line-clamp-3",
					)}
				>
					{error}
				</button>
			</div>
		</div>
	);
}

/** Out across the pane's padding to its edges: a phone's is narrower. */
export function bleed(phone: boolean): string {
	return phone ? "-mx-1" : "-mx-4";
}
