import type { SignalOverview } from "@splates/server/signals";
import {
	BanIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleStopIcon,
	HourglassIcon,
	ZapIcon,
} from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { errored } from "./signal-of";
import { type SignalTone, statusOf } from "./signal-status";
import { liveCount } from "./signal-summary";

const TONE_ICONS: Record<SignalTone, typeof HourglassIcon> = {
	polling: HourglassIcon,
	passed: CircleCheckIcon,
	broken: CircleAlertIcon,
	stopped: CircleStopIcon,
	removed: BanIcon,
	quiet: ZapIcon,
};

/** The top of a signal's page: what it means when it fires, then the outcome, when, the last output line and how many wait. */
export function Glance({
	signal,
	now,
}: {
	signal: SignalOverview;
	now: number;
}): JSX.Element {
	const status = statusOf(signal, now);
	const Icon = TONE_ICONS[status.tone];
	const last = signal.probe?.runs.at(-1);
	const output = last?.output.trim().split("\n")[0] ?? "";
	const live = liveCount(signal);
	const waits = signal.subscribers.filter(
		(each) => each.live && each.kind === "wait",
	).length;
	return (
		<div className="rounded-xl border bg-card shadow-xs">
			{signal.description !== undefined && (
				<div className="border-b px-4 py-3 text-sm">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Fires when
					</p>
					<p className="mt-0.5 break-words">{signal.description}</p>
				</div>
			)}
			<div
				role="status"
				aria-label="how it stands"
				className="flex items-center gap-4 p-4"
			>
				<span
					className={cn(
						"flex size-12 shrink-0 items-center justify-center rounded-full bg-muted",
						status.tone === "passed" && "text-success",
						status.tone === "broken" && "text-destructive",
						status.tone === "polling" && "text-info",
						(status.tone === "quiet" ||
							status.tone === "stopped" ||
							status.tone === "removed") &&
							"text-muted-foreground",
					)}
				>
					<Icon className="size-5" />
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<p
						className={cn(
							"font-semibold text-xl tracking-tight",
							status.tone === "broken" && "text-destructive",
						)}
					>
						{status.headline}
					</p>
					<p className="text-muted-foreground text-sm">
						{status.when.replace(/^./, (first) => first.toUpperCase())}
					</p>
					{output !== "" && (
						<p
							className={cn(
								"mt-1 truncate font-mono text-muted-foreground text-xs",
								last !== undefined && errored(last) && "text-destructive",
							)}
							title={last?.output}
						>
							› {output}
						</p>
					)}
				</div>
				{live > 0 && (
					<div className="shrink-0 text-right">
						<p className="font-semibold text-xl tabular-nums">{live}</p>
						<p className="text-muted-foreground text-xs">
							{waits === live
								? "waiting"
								: live === 1
									? "subscriber"
									: "subscribers"}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
