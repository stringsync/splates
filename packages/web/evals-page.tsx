import type {
	EvalBatch,
	EvalGrid,
} from "@stringsync/splates-server/evals/browser";
import { targetName } from "@stringsync/splates-server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { evalBatch, evalBatches } from "./api";
import { BackButton } from "./back-button";
import { ReadingNow } from "./countdown";
import { EvalAgentsEditor } from "./eval-agents";
import { EvalAgentsView } from "./eval-agents-view";
import { EvalDebug } from "./eval-debug";
import { EvalReport } from "./eval-report";
import { ORDER, StatusChip, spent } from "./eval-status";
import type { EvalsOpen } from "./page-address";
import { TopBar } from "./top-bar";

/** How often an open batch with cells still to land is read again. */
const FOLLOW = Duration.secs(3);

/**
 * The Evals page: every eval batch run on this machine, newest first. Open a
 * batch for its report and a cell of the report for its run; the bar leads
 * back up a level. Browsing costs no tokens.
 */
export function EvalsPage({
	open: { batch: open, run },
	onOpen,
}: {
	/** The batch open, and its run, each null for none, as the address has them. */
	open: EvalsOpen;
	onOpen: (batch: string | null, run?: string | null) => void;
}): JSX.Element {
	const [agents] = useState(() => new EvalAgentsEditor());
	const [batches, setBatches] = useState<EvalBatch[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Read each time the list is shown: batches land while it is away.
	useEffect(() => {
		if (open !== null) {
			return;
		}
		evalBatches().then(
			(each) => setBatches(each ?? []),
			(failed: unknown) =>
				setError(failed instanceof Error ? failed.message : String(failed)),
		);
	}, [open]);
	return (
		<section aria-label="evals" className="flex min-w-0 flex-col gap-4">
			<TopBar
				leading={
					open === null ? undefined : run !== null ? (
						<BackButton parent="Report" onBack={() => onOpen(open)} />
					) : (
						<BackButton parent="Evals" onBack={() => onOpen(null)} />
					)
				}
				title={open === null ? "Evals" : run !== null ? "Run" : "Report"}
			/>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{open === null && <EvalAgentsView editor={agents} />}
			{open !== null && run !== null ? (
				<EvalDebug id={run} />
			) : open !== null ? (
				<Batch id={open} onOpen={(each) => onOpen(open, each)} />
			) : batches === null ? (
				error === null && <ReadingNow label="Reading evals…" />
			) : batches.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No eval has run on this machine yet. Each run of{" "}
					<code>splates dev eval</code> is saved in ~/.splates/evals and shows
					here.
				</p>
			) : (
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
