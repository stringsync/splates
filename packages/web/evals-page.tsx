import { age } from "@splates/server/age";
import type { EvalBatch } from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { evalBatch, evalBatches } from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { EvalAgentsEditor } from "./eval-agents";
import { EvalAgentsRow } from "./eval-agents-row";
import { EvalDebug } from "./eval-debug";
import { EvalHistory } from "./eval-history";
import { EvalScenarioTable } from "./eval-scenario-table";
import { summarizeTests } from "./eval-spec-data";
import { landingTest } from "./eval-spec-results";
import { EvalTestPage } from "./eval-test-page";
import { HistoryRow, PLANNER_COLUMN } from "./history-row";
import { cn } from "./lib/utils";
import type { EvalsOpen } from "./page-address";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";

/** Browse evaluation scenarios, improvement activity and reports. Pass open to inspect evidence and onOpen to navigate. */
export function EvalsPage({
	open: { batch: open, run, plan, tab: routeTab, test, file: openFile },
	onOpen,
	feed = null,
}: {
	/** The batch open, its run and the scenario planned, each null for none, as the address has them. */
	open: EvalsOpen;
	onOpen: (
		batch: string | null,
		run?: string | string[] | null,
		test?: string | null,
	) => void;
	/** Where a conversation started from the scenarios is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
}): JSX.Element {
	const history = routeTab === "history";
	const file = openFile ?? null;
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
	if (plan === null && open !== null && test !== undefined) {
		return (
			<EvalTestPage
				key={test}
				batch={open}
				scenario={test}
				run={run}
				onEvals={() => onOpen(null)}
				onPick={(each) => onOpen(open, each, test)}
				onRound={(each) => onOpen(each, null, test)}
			/>
		);
	}
	if (plan === null && open !== null && run !== null) {
		return <EvalDebug key={run} id={run} onEvals={() => onOpen(null)} />;
	}
	return (
		<section aria-label="evals" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title={
					open === null && plan === null && !history && file === null ? (
						"Evals"
					) : (
						<RouteTrail
							items={[
								{ label: "Evals", onClick: () => onOpen(null) },
								...(file !== null && open === null && plan === null
									? [{ label: file.slice(file.lastIndexOf("/") + 1) }]
									: history && open === null && plan === null
										? [{ label: "History" }]
										: plan !== null
											? [{ label: "Plan" }]
											: [{ label: "Run" }]),
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
					{ready && file === null && (
						<HistoryRow href="#evals/history" summary={runsSummary(batches)} />
					)}
					{ready && file === null && <EvalAgentsRow editor={agents} />}
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
							key={file ?? ""}
							agents={agents}
							file={file}
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
			) : open !== null ? (
				<Landing id={open} onOpen={(each) => onOpen(open, null, each)} />
			) : null}
		</section>
	);
}

/** A batch address with no test: opens the batch's landing test, the first failing or the first. */
function Landing({
	id,
	onOpen,
}: {
	id: string;
	onOpen: (test: string) => void;
}): JSX.Element {
	const [error, setError] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `onOpen` changes each render; the batch is read once
	useEffect(() => {
		let current = true;
		evalBatch(id).then(
			(grid) => {
				const tests = summarizeTests(grid);
				if (!current) {
					return;
				}
				if (tests.length > 0) {
					onOpen(landingTest(tests).id);
				} else {
					setError("This run has no tests.");
				}
			},
			(failed: unknown) =>
				current &&
				setError(failed instanceof Error ? failed.message : String(failed)),
		);
		return () => {
			current = false;
		};
	}, [id]);
	return error === null ? (
		<p role="status" className="text-muted-foreground text-sm">
			Reading the run…
		</p>
	) : (
		<p role="alert" className="text-destructive text-sm">
			{error}
		</p>
	);
}

/** The History row's line: how many runs are kept, and when the last started. */
function runsSummary(batches: EvalBatch[] | null): string | null {
	const last = batches?.[0];
	return last === undefined || batches === null
		? null
		: `${batches.length} ${batches.length === 1 ? "run" : "runs"} · last ${age(last.startedAt)} ago`;
}
