import type { EvalBatch, EvalGrid } from "@splates/server/evals/browser";
import { targetName } from "@splates/server/evals/browser";
import { Duration, SystemTimer } from "core/time";
import { type JSX, useEffect, useState } from "react";
import { evalBatch, evalBatches } from "./api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import type { ConversationFeed } from "./conversation-feed";
import { EvalActive } from "./eval-active";
import { EvalAgentsEditor } from "./eval-agents";
import { EvalDebug } from "./eval-debug";
import { useEvalConversations } from "./eval-loops";
import { EvalReport, EvalReportSkeleton } from "./eval-report";
import { EvalScenarioTable } from "./eval-scenario-table";
import { EvalSection } from "./eval-section";
import {
	budgetText,
	ORDER,
	roundsText,
	StatusChip,
	spent,
} from "./eval-status";
import type { EvalsOpen } from "./page-address";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";

/** How often an open batch with cells still to land is read again. */
const FOLLOW = Duration.secs(3);

/** Browse evaluation scenarios, improvement activity and reports. Pass open to inspect evidence and onOpen to navigate. */
export function EvalsPage({
	open: { batch: open, run, plan, tab: routeTab },
	onOpen,
	onOpenConversation,
	feed = null,
}: {
	/** The batch open, its run and the scenario planned, each null for none, as the address has them. */
	open: EvalsOpen;
	/** Opens an eval conversation through the app navigation. */
	onOpenConversation: (id: string) => void;
	onOpen: (batch: string | null, run?: string | string[] | null) => void;
	/** Where a conversation started from the scenarios is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
}): JSX.Element {
	const [tab, setTab] = useState(routeTab ?? "plan");
	const conversations = useEvalConversations(feed);
	useEffect(() => {
		setTab(routeTab ?? "plan");
	}, [routeTab]);
	const showTab = (next: string): void => {
		setTab(next);
		location.hash = next === "plan" ? "evals" : `evals/${next}`;
	};
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
			{listing && tab === "plan" && !ready && error === null && (
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
			{listing && (
				<Tabs value={tab} onValueChange={showTab} className="gap-6">
					<TabsList variant="line" aria-label="Evals views">
						<TabsTrigger value="plan">Plan</TabsTrigger>
						<TabsTrigger value="active">
							Active ({conversations.length})
						</TabsTrigger>
						<TabsTrigger value="history">History</TabsTrigger>
					</TabsList>
					<TabsContent value="plan" keepMounted>
						<div
							hidden={!ready && error === null}
							className="flex flex-col gap-6"
						>
							<EvalScenarioTable
								agents={agents}
								onOpenBatch={(batch) => onOpen(batch)}
								feed={feed}
								onLoaded={() => setScenariosRead(true)}
								onStarted={() => showTab("active")}
							/>
						</div>
					</TabsContent>
					<TabsContent value="active">
						<EvalActive
							conversations={conversations}
							onOpen={onOpenConversation}
						/>
					</TabsContent>
					<TabsContent value="history">
						{batches === null ? (
							<p role="status">Reading runs…</p>
						) : (
							<BatchHistory batches={batches} onOpen={onOpen} />
						)}
					</TabsContent>
				</Tabs>
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

/** Saved eval batches, separate from planning and live conversations. */
function BatchHistory({
	batches,
	onOpen,
}: {
	batches: EvalBatch[];
	onOpen: (batch: string) => void;
}): JSX.Element {
	return batches.length === 0 ? (
		<p className="text-muted-foreground text-sm">
			No eval has run on this machine yet. Each run of <code>evals run</code> is
			saved in ~/.splates/evals and shows here.
		</p>
	) : (
		<EvalSection
			label="batches"
			title="Recent runs"
			count={batches.length}
			defaultOpen={false}
		>
			<ul className="flex flex-col gap-4">
				{batches.map((batch) => (
					<li
						key={batch.id}
						className="overflow-hidden rounded-xl border bg-card px-5 shadow-xs"
					>
						<button
							type="button"
							onClick={() => onOpen(batch.id)}
							className="flex w-full min-w-0 flex-col gap-1.5 py-4 text-left hover:bg-accent/50"
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
											<span key={status} className="flex items-center gap-0.5">
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
							{batch.budget !== undefined && (
								<span className="text-muted-foreground text-xs">
									{budgetText(batch.budget)} · {roundsText(batch.budget)}
								</span>
							)}
						</button>
					</li>
				))}
			</ul>
		</EvalSection>
	);
}
