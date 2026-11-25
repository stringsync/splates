import { useAuiState } from "@assistant-ui/react";
import { type JSX, useContext, useMemo } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Board } from "./board";
import { useMinute } from "./hooks/use-minute";
import { PulsingDot } from "./signal-card";
import { lasted } from "./signal-of";
import { type WaitRequest, waitIn } from "./wait-request";

/**
 * The bar above the composer while the agent waits on a task or an idle
 * machine, in the signal bar's look, led by its pulsing dot: one row saying what it waits for, how
 * long so far, and View to open a waited-on task. It goes once the wait ends,
 * which is when a message follows the reply that asked for it.
 * @internal
 */
export function AgentWaitBar(): JSX.Element | null {
	// A string, so the bar wakes only when the wait itself changes.
	const held = useAuiState((state) => {
		const last = state.thread.messages.at(-1);
		if (last?.role !== "assistant") {
			return null;
		}
		const text = last.content.findLast((part) => part.type === "text");
		const found = text?.type === "text" ? waitIn(text.text) : null;
		if (found === null) {
			return null;
		}
		const stamp = last.metadata.custom.at;
		return JSON.stringify({
			wait: found.wait,
			at: typeof stamp === "string" ? stamp : null,
		});
	});
	const live = useMemo(
		() =>
			held === null
				? null
				: (JSON.parse(held) as { wait: WaitRequest; at: string | null }),
		[held],
	);
	if (live === null) {
		return null;
	}
	return (
		<aside aria-label="Waiting">
			<AgentWaitBarView wait={live.wait} at={live.at} />
		</aside>
	);
}

/** The bar itself, for a wait under way since `at`, if known. */
export function AgentWaitBarView({
	wait,
	at,
}: {
	wait: WaitRequest;
	at: string | null;
}): JSX.Element {
	const board = useContext(Board);
	const now = useMinute();
	const open =
		wait.type === "task" && board.linked && board.tasks.includes(wait.task)
			? () => board.openTask(wait.task)
			: null;
	return (
		<section
			data-card
			className="@container relative flex min-h-[50px] items-center gap-3 overflow-hidden rounded-lg border bg-card px-4 py-2.5 text-sm shadow-xs"
		>
			<PulsingDot />
			<span className="flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-nowrap">
				<span className="shrink-0">Waiting for</span>
				{wait.type === "task" ? (
					<>
						<span
							title={`Task ${wait.task}`}
							className="min-w-0 max-w-full shrink-0 truncate font-mono"
						>
							{wait.task}
						</span>
						{/* Gone, not cut short, where the name leaves it no room. */}
						<span className="hidden @min-[26rem]:inline">to finish</span>
					</>
				) : (
					<span className="min-w-0 truncate">
						the machine to stay idle {wait.duration}
					</span>
				)}
			</span>
			{at !== null && (
				<span className="hidden shrink-0 text-muted-foreground text-xs tabular-nums @min-[32rem]:block">
					{lasted(at, new Date(now).toISOString())} so far
				</span>
			)}
			{open !== null && (
				<Button
					size="sm"
					variant="outline"
					aria-label={`View task ${wait.type === "task" ? wait.task : ""}`}
					onClick={open}
					className="bg-background"
				>
					View
				</Button>
			)}
		</section>
	);
}
