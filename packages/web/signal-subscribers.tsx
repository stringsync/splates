import type { SignalSubscriber } from "@splates/server/signals";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { pauseSubscription, stopWait } from "./api/signals";
import { timeLeft } from "./signal-of";

/** Waits and automations as one list: every row has a kind tag, label, state and its action. */
export function Subscribers({
	subscribers,
	now,
	onOpen,
	act,
}: {
	subscribers: SignalSubscriber[];
	now: number;
	onOpen: (id: string) => void;
	act: (what: () => Promise<void>) => void;
}): JSX.Element {
	return (
		<section aria-label="subscribers" className="flex flex-col gap-1.5">
			{subscribers.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					Nothing waits on or runs from this signal.
				</p>
			) : (
				<ul className="flex flex-col divide-y text-sm">
					{subscribers.map((each) => (
						<Subscriber
							key={`${each.kind}:${each.id}`}
							sub={each}
							now={now}
							onOpen={onOpen}
							act={act}
						/>
					))}
				</ul>
			)}
			<a
				href="#automations"
				className="self-start text-muted-foreground text-xs underline-offset-2 hover:underline"
			>
				Manage automations
			</a>
		</section>
	);
}

function Subscriber({
	sub,
	now,
	onOpen,
	act,
}: {
	sub: SignalSubscriber;
	now: number;
	onOpen: (id: string) => void;
	act: (what: () => Promise<void>) => void;
}): JSX.Element {
	const drop =
		sub.kind === "wait"
			? () => stopWait(sub.conversation ?? "", sub.id)
			: () => pauseSubscription(sub.project ?? "", sub.id);
	return (
		<li className="flex flex-wrap items-center gap-2 py-1.5">
			<span
				className={cn(
					"min-w-[4.5rem] rounded border px-1.5 py-px text-center text-[11px]",
					sub.kind !== "automation"
						? "bg-muted text-muted-foreground"
						: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
				)}
			>
				{sub.kind === "wait"
					? "Wait"
					: sub.kind === "task"
						? "Task"
						: "Automation"}
			</span>
			{sub.kind === "wait" && sub.conversation !== undefined ? (
				<button
					type="button"
					className="truncate text-left underline-offset-2 hover:underline"
					onClick={() => onOpen(sub.conversation ?? "")}
				>
					{sub.title ?? sub.label}
				</button>
			) : (
				<span className="truncate">{sub.label}</span>
			)}
			<span className="text-muted-foreground text-xs">
				{sub.state}
				{sub.live &&
					sub.deadline !== undefined &&
					` · ${timeLeft(sub.deadline, now)} left`}
			</span>
			{sub.live && sub.kind !== "task" && (
				<Button
					size="sm"
					variant="ghost"
					className="ml-auto h-11 sm:h-8"
					onClick={() => act(drop)}
				>
					{sub.kind === "wait" ? "Drop" : "Pause"}
				</Button>
			)}
		</li>
	);
}
