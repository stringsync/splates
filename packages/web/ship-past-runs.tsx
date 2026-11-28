import type { RunState } from "@splates/server/ship";
import { waitingIn } from "@splates/server/ship/browser";
import { ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { shipRuns } from "./api/ship";
import { Card, CardList } from "./components/ui/card";
import { shipRunAddress } from "./page-address";
import { PageSection } from "./page-section";

const SAID = {
	running: "Shipping now",
	done: "Shipped",
	failed: "Failed",
	stopped: "Stopped",
};

/** The Ships page's History: every run, newest first, each opening its run. */
export function ShipPastRuns({
	read = shipRuns,
}: {
	read?: () => Promise<RunState[]>;
}): JSX.Element {
	const [runs, setRuns] = useState<RunState[] | "failed" | null>(null);
	useEffect(() => {
		read().then(setRuns, () => setRuns("failed"));
	}, [read]);
	return (
		<PageSection
			label="Runs"
			title="Past ships"
			description={
				Array.isArray(runs) && runs.length > 0
					? runs.length === 1
						? "1 run."
						: `${runs.length} runs, newest first.`
					: undefined
			}
		>
			{runs === null ? (
				<p className="text-muted-foreground text-sm">Reading runs…</p>
			) : runs === "failed" ? (
				<p className="text-destructive text-sm">Could not read the runs.</p>
			) : runs.length === 0 ? (
				<p className="text-muted-foreground text-sm">No runs yet.</p>
			) : (
				<ShipRunList runs={runs} />
			)}
		</PageSection>
	);
}

/** Runs one line each, each opening its run. */
export function ShipRunList({
	runs,
	bar = false,
}: {
	runs: readonly RunState[];
	/** Whether each row carries a bar of its finished steps. */
	bar?: boolean;
}): JSX.Element {
	return (
		<Card>
			<CardList>
				{runs.map((run) => (
					<RunRow key={run.id} run={run} bar={bar} />
				))}
			</CardList>
		</Card>
	);
}

/** A run's line: its targets, how it stands and when, and what waits on the user. */
function RunRow({ run, bar }: { run: RunState; bar: boolean }): JSX.Element {
	const steps = run.targets.flatMap((each) => each.steps);
	const finished = steps.filter(
		(each) => each.status === "done" || each.status === "skipped",
	).length;
	const waiting = waitingIn(run).at(0);
	return (
		<li>
			<a
				href={shipRunAddress(run.id)}
				className="flex items-center gap-3 px-3.5 py-3 text-sm"
			>
				<span className="flex min-w-0 flex-1 flex-col gap-2.5">
					<span className="flex items-baseline gap-2">
						<span className="min-w-0 flex-1 truncate">
							{run.targets.map((each) => each.name).join(", ")}
						</span>
						<span
							className={
								run.status === "failed"
									? "shrink-0 text-destructive text-xs"
									: "shrink-0 text-muted-foreground text-xs"
							}
						>
							{waiting !== undefined ? "Shipping now" : SAID[run.status]} ·{" "}
							{new Date(run.started).toLocaleString(undefined, {
								month: "short",
								day: "numeric",
								hour: "numeric",
								minute: "2-digit",
							})}
						</span>
					</span>
					{waiting !== undefined && (
						<span className="flex items-center gap-1.5 font-medium text-xs">
							<span
								aria-hidden
								className="size-2 shrink-0 rounded-full bg-warning"
							/>
							Waiting on you: {waiting.does}
						</span>
					)}
					{bar && (
						<div className="flex min-h-8 items-center">
							<div
								role="progressbar"
								aria-label="Steps done"
								aria-valuemin={0}
								aria-valuemax={steps.length}
								aria-valuenow={finished}
								className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
							>
								<div
									className={
										run.status === "failed"
											? "h-full rounded-full bg-destructive"
											: "h-full rounded-full bg-foreground"
									}
									style={{
										width: `${steps.length === 0 ? 0 : (finished / steps.length) * 100}%`,
									}}
								/>
							</div>
						</div>
					)}
				</span>
				<ChevronRightIcon
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground"
				/>
			</a>
		</li>
	);
}
