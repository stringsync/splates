import { HeartPulseIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";
import { useNow } from "./hooks/use-now";

/**
 * Under a conversation's header while arbor has a heartbeat due it, across
 * the pane's padding to its edges: how long until arbor asks it to check on
 * the agents it handed tasks to, which any turn it takes first puts off.
 */
export function HeartbeatBanner({
	at,
	phone,
}: {
	/** When the heartbeat goes, as an ISO time. */
	at: string;
	phone: boolean;
}): JSX.Element {
	const left = Math.max(0, Math.ceil((Date.parse(at) - useNow()) / 1000));
	return (
		<p
			role="status"
			data-slot="heartbeat-banner"
			className={cn(
				phone ? "-mx-1" : "-mx-4",
				"flex shrink-0 items-center gap-2 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<HeartPulseIcon className="size-4 shrink-0" />
			<span>
				<span className="font-medium text-foreground tabular-nums">
					Heartbeat in {Math.floor(left / 60)}:
					{String(left % 60).padStart(2, "0")}.
				</span>{" "}
				It checks on its agents then, unless it speaks first.
			</span>
		</p>
	);
}
