import type { EvalBatch, EvalGrid } from "@splates/server/evals/browser";
import { targetName } from "@splates/server/evals/browser";
import { Duration, SystemTimer } from "core/time";
import { type JSX, useEffect, useState } from "react";
import { evalBatch, evalBatches } from "./api";
import { ReadingNow } from "./countdown";
import { EvalActivity } from "./eval-activity";
import { EvalDebug } from "./eval-debug";
import { EvalReport } from "./eval-report";
import { EvalScenarios } from "./eval-scenarios-view";
import { EvalSection } from "./eval-section";
import { ORDER, StatusChip, spent } from "./eval-status";
import type { EvalsOpen } from "./page-address";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";

/** How often an open batch with cells still to land is read again. */
const FOLLOW = Duration.secs(3);

/** Browse evaluation scenarios, improvement activity and reports. Pass open to inspect evidence and onOpen to navigate. */
export function EvalsPage({
	open: { batch: open, run, plan },
	onOpen,
}: {
	/** The batch open, its run and the scenario planned, each null for none, as the address has them. */
	open: EvalsOpen;
	onOpen: (batch: string | null, run?: string | string[] | null) => void;
}): JSX.Element {
	const [batches, setBatches] = useState<EvalBatch[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Read each time the list is shown: batches land while it is away.
	useEffect(() => {
		if (open !== null || plan !== null) {
			return;
		}
		evalBatches().then(
			(each) => setBatches(each ?? []),
			(failed: unknown) =>
				setError(failed instanceof Error ? failed.message : String(failed)),
		);
	}, [open, plan]);
	return (
		<section aria-label="evals" className="flex min-w-0 flex-col gap-4">
			<TopBar
				title={
					open === null && plan === null ? (
						"Evals"
					) : (
						<RouteTrail
							items={[
								{ label: "Evals", onClick: () => onOpen(null) },
								...(plan !== null
									? [{ label: "Plan" }]
									: run !== null
										? [
												{ label: "Report", onClick: () => onOpen(open) },
												{ label: "Run" },
											]
										: [{ label: "Report" }]),
							]}
						/>
					)
				}
			/>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{open === null && <EvalActivity />}
			{open === null && plan === null && (
				<EvalScenarios onOpenBatch={(batch) => onOpen(batch)} />
			)}
			{plan !== null ? (
				<p className="text-muted-foreground text-sm">
					Run evals from a conversation. Browse results on Evals.
				</p>
			) : open !== null && run !== null ? (
				<EvalDebug id={run} />
			) : open !== null ? (
				<Batch id={open} onOpen={(each) => onOpen(open, each)} />
			) : batches === null ? (
				error === null && <ReadingNow label="Reading evals…" />
			) : batches.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No eval has run on this machine yet. Each run of{" "}
					<code>evals run</code> is saved in ~/.splates/evals and shows here.
				</p>
			) : (
				<EvalSection
					label="batches"
					title="Recent runs"
					count={batches.length}
					defaultOpen={false}
				>
					<ul className="flex flex-col divide-y">
						{batches.map((batch) => (
							<li key={batch.id}>
								<button
									type="button"
									onClick={() => onOpen(batch.id)}
									className="flex w-full min-w-0 flex-col gap-1 py-3 text-left hover:bg-accent/50"
								>
									<span className="flex min-w-0 flex-wrap items-center gap-2">
										<span className="font-medium text-sm">
											{new Date(batch.startedAt).toLocaleString()}
										</span>
										<span className="text-muted-foreground text-xs">
											{batch.skill ?? "evals"}
										</span>
										<span className="flex gap-1">
											{ORDER.filter((status) => batch.tally[status]).map(
												(status) => (
													<span
														key={status}
														className="flex items-center gap-0.5"
													>
														<StatusChip status={status} />
														<span className="text-xs tabular-nums">
															{batch.tally[status]}
														</span>
													</span>
												),
											)}
										</span>
									</span>
									<span className="text-muted-foreground text-xs">
										{batch.targets.map(targetName).join(", ")} · {batch.cells}{" "}
										{batch.cells === 1 ? "cell" : "cells"} · {spent(batch)}
									</span>
								</button>
							</li>
						))}
					</ul>
				</EvalSection>
			)}
		</section>
	);
}

/** One batch as its report card, read again while cells are still to land. */
function Batch({
	id,
	onOpen,
}: {
	id: string;
	onOpen: (run: string) => void;
}): JSX.Element {
	const [grid, setGrid] = useState<EvalGrid | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let timer: { dispose(): void } | null = null;
		let current = true;
		const read = (): void => {
			evalBatch(id).then(
				(each) => {
					if (!current) {
						return;
					}
					setGrid(each);
					if (each.tally.pending) {
						timer = new SystemTimer().setTimeout(read, FOLLOW);
					}
				},
				(failed: unknown) =>
					current &&
					setError(failed instanceof Error ? failed.message : String(failed)),
			);
		};
		read();
		return () => {
			current = false;
			timer?.dispose();
		};
	}, [id]);
	return (
		<div className="flex min-w-0 flex-col gap-3">
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{grid === null && error === null && (
				<ReadingNow label="Reading the batch…" />
			)}
			{grid !== null && <EvalReport grid={grid} onOpen={onOpen} />}
		</div>
	);
}
