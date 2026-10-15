import { HeartPulseIcon } from "lucide-react";
import type { JSX } from "react";
import { Duration } from "webappwiz/time";
import { cn } from "#dev/lib/utils.ts";
import { useNow } from "./hooks/use-now";

/** How close the heartbeat comes before the banner shows its countdown. */
export const HEARTBEAT_SHOWN = Duration.mins(5);

/**
 * Under a conversation's header once a heartbeat due it is `HEARTBEAT_SHOWN`
 * away, across the pane's padding to its edges: how long until arbor asks it
 * to check on the agents it handed tasks to, which any turn it takes first
 * puts off, with a bar along its foot that drains as it nears. Nothing before
 * then, so a long wait does not sit over the thread.
 */
export function HeartbeatBanner({
	at,
	phone,
}: {
	/** When the heartbeat goes, as an ISO time. */
	at: string;
	phone: boolean;
}): JSX.Element | null {
	const left = Math.max(0, Math.ceil((Date.parse(at) - useNow()) / 1000));
	if (left > HEARTBEAT_SHOWN.secs) {
		return null;
	}
	return (
		<p
			role="status"
			data-slot="heartbeat-banner"
			className={cn(
				phone ? "-mx-1" : "-mx-4",
				"relative flex shrink-0 items-center gap-2 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<HeartPulseIcon className="size-4 shrink-0 text-info motion-safe:animate-pulse" />
			<span>
				<span className="font-medium text-foreground tabular-nums">
					Heartbeat in {Math.floor(left / 60)}:
					{String(left % 60).padStart(2, "0")}.
				</span>{" "}
				It checks on its agents then, unless it speaks first.
			</span>
			<span
				aria-hidden
				className="absolute bottom-0 left-0 h-0.5 bg-info/60 transition-[width] duration-1000 ease-linear"
				style={{ width: `${(left / HEARTBEAT_SHOWN.secs) * 100}%` }}
			/>
		</p>
	);
}
