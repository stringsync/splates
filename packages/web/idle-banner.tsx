import { IDLE_STOP } from "@stringsync/splates-server/conversations/browser";
import { MoonIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * Under a conversation's header while splates has its agent stopped for sitting
 * idle, across the pane's padding to its edges: why its process is gone, so
 * the person does not take it for a crash, and what wakes it.
 */
export function IdleBanner({ phone }: { phone: boolean }): JSX.Element {
	return (
		<p
			role="status"
			data-slot="idle-banner"
			className={cn(
				phone ? "-mx-1" : "-mx-4",
				"flex shrink-0 items-center gap-2 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<MoonIcon className="size-4 shrink-0" />
			<span>
				<span className="font-medium text-foreground">
					Stopped after {IDLE_STOP.mins} minutes idle.
				</span>{" "}
				Sending a message starts it again where it left off.
			</span>
		</p>
	);
}
