import { age } from "@splates/server/age";
import type { EvalBatch, EvalGrid } from "@splates/server/evals/browser";
import { Duration, SystemTimer } from "core/time";
import { type JSX, useEffect, useState } from "react";
import { evalBatch, evalBatches } from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { EvalAgentsEditor } from "./eval-agents";
import { EvalDebug } from "./eval-debug";
import { EvalHistory } from "./eval-history";
import { EvalReport, EvalReportSkeleton } from "./eval-report";
import { EvalScenarioTable } from "./eval-scenario-table";
import { HistoryRow, PLANNER_COLUMN } from "./history-row";
import { cn } from "./lib/utils";
import type { EvalsOpen } from "./page-address";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";

/** How often an open batch with cells still to land is read again. */
const FOLLOW = Duration.secs(3);

/** Browse evaluation scenarios, improvement activity and reports. Pass open to inspect evidence and onOpen to navigate. */
export function EvalsPage({
	open: { batch: open, run, plan, tab: routeTab },
	onOpen,
	feed = null,
}: {
	/** The batch open, its run and the scenario planned, each null for none, as the address has them. */
	open: EvalsOpen;
	onOpen: (batch: string | null, run?: string | string[] | null) => void;
	/** Where a conversation started from the scenarios is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
}): JSX.Element {
	const history = routeTab === "history";
	const [batches, setBatches] = useState<EvalBatch[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [scenariosRead, setScenariosRead] = useState(false);
	const [agents] = useState(() => new EvalAgentsEditor());
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
	const listing = open === null && plan === null;
	const ready = batches !== null && scenariosRead;
	return (
		<section aria-label="evals" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title={
					open === null && plan === null && !history ? (
						"Evals"
					) : (
						<RouteTrail
							items={[
								{ label: "Evals", onClick: () => onOpen(null) },
								...(history && open === null && plan === null
									? [{ label: "History" }]
									: plan !== null
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
			{listing && history && (
				<div className={PLANNER_COLUMN}>
					{batches === null ? (
						<p role="status">Reading runs…</p>
					) : (
						<EvalHistory batches={batches} onOpen={(batch) => onOpen(batch)} />
					)}
				</div>
			)}
			{listing && !history && (
				<div className={cn(PLANNER_COLUMN, "gap-4")}>
					<HistoryRow href="#evals/history" summary={runsSummary(batches)} />
					{!ready && error === null && (
						<section
							aria-label="evals loading"
							aria-busy
							className="flex min-h-64 items-center justify-center"
						>
							<p
								role="status"
								aria-label="Loading evals"
								className="w-fit shimmer text-muted-foreground motion-reduce:animate-none"
							>
								Loading
							</p>
						</section>
					)}
					<div
						hidden={!ready && error === null}
						className="flex flex-col gap-6"
					>
						<EvalScenarioTable
							agents={agents}
							onOpenBatch={(batch) => onOpen(batch)}
							feed={feed}
							onLoaded={() => setScenariosRead(true)}
						/>
					</div>
				</div>
			)}
			{plan !== null ? (
				<p className="text-muted-foreground text-sm">
					Run evals from a conversation. Browse results on Evals.
				</p>
			) : open !== null && run !== null ? (
				<EvalDebug id={run} />
			) : open !== null ? (
				<Batch id={open} onOpen={(each) => onOpen(open, each)} />
			) : null}
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
		<div className="flex min-w-0 flex-col gap-4">
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{grid === null && error === null && <EvalReportSkeleton />}
			{grid !== null && <EvalReport grid={grid} onOpen={onOpen} />}
		</div>
	);
}

/** The History row's line: how many runs are kept, and when the last started. */
function runsSummary(batches: EvalBatch[] | null): string | null {
	const last = batches?.[0];
	return last === undefined || batches === null
		? null
		: `${batches.length} ${batches.length === 1 ? "run" : "runs"} · last ${age(last.startedAt)} ago`;
}
