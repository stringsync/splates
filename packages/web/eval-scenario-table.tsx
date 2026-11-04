import {
	type EvalScenario,
	type EvalScenarioState,
	type EvalScenarioStatus,
	targetOf,
} from "@splates/server/evals/browser";
import { useReactive } from "core/react";
import { ChevronDownIcon, ChevronRightIcon, PlayIcon } from "lucide-react";
import { Fragment, type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { cn } from "#web/lib/utils.ts";
import { evalRun, evalScenarios, evalStates } from "./api";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { ReadingNow } from "./countdown";
import type { EvalAgentsEditor } from "./eval-agents";
import { scenarioPrompt } from "./eval-improve";
import { loopLabel, useEvalLoops } from "./eval-loops";
import { DEFAULT_REPS, RunDialog } from "./eval-run-dialog";
import { ScenarioHistory } from "./eval-scenario-history";
import {
	countStates,
	filterRows,
	passCount,
	projectsOf,
	rowsOf,
	type ScenarioFilter,
	STATE_LABEL,
	STATES,
	summaryOf,
} from "./eval-scenarios";

const STATE_TONE: Record<EvalScenarioStatus, string> = {
	failing: "bg-destructive/15 text-destructive",
	"never-run": "bg-muted text-muted-foreground",
	stale: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
	passing: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

/**
 * Every scenario the project lists as a table, worst first: how many are
 * passing, filter chips with counts, the worst failing one up top with the
 * judge's reason, and per row a pass count on each saved agent, when it last
 * ran and one button to run it. A row opens the batches that ran it. Browsing
 * costs nothing; Run only opens a card, and its Start opens a conversation to
 * work the scenario's loop.
 */
export function EvalScenarioTable({
	agents,
	onOpenBatch,
	feed = null,
}: {
	/** The saved eval agents: a column each, and the ones a run card ticks. */
	agents: EvalAgentsEditor;
	onOpenBatch: (batch: string) => void;
	/** Where a conversation started from here is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
}): JSX.Element {
	const [scenarios, setScenarios] = useState<EvalScenario[] | null>(null);
	const [states, setStates] = useState<EvalScenarioState[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<ScenarioFilter>({
		state: null,
		project: null,
	});
	const [picked, setPicked] = useState<string[]>([]);
	const [open, setOpen] = useState<string | null>(null);
	const [running, setRunning] = useState<string[] | null>(null);
	const [pending, setPending] = useState(false);
	const saved = useReactive(agents, (each) => each.picks, ["changed"]);
	const targets = saved.map(targetOf);
	const loops = useEvalLoops(feed);
	const runOrOpen = (ids: string[]): void => {
		const loop = ids.length === 1 ? loops.get(ids[0] ?? "") : undefined;
		if (loop !== undefined) {
			location.hash = `conversations/${loop.id}`;
		} else {
			setRunning(ids);
		}
	};
	useEffect(() => void agents.load(), [agents]);
	useEffect(() => {
		let current = true;
		const fail = (failed: unknown): void => {
			if (current) {
				setError(failed instanceof Error ? failed.message : String(failed));
			}
		};
		Promise.all([evalScenarios(), evalStates()]).then(([listed, each]) => {
			if (current) {
				setScenarios(Array.isArray(listed) ? listed : []);
				setStates(Array.isArray(each) ? each : []);
			}
		}, fail);
		return () => {
			current = false;
		};
	}, []);
	const rows = rowsOf(scenarios ?? [], states);
	const counts = countStates(rows);
	const shown = filterRows(rows, filter);
	const projects = projectsOf(rows);
	const next = rows.find((row) => row.state.state === "failing");
	const toggle = (id: string): void =>
		setPicked((now) =>
			now.includes(id) ? now.filter((each) => each !== id) : [...now, id],
		);
	// Each scenario is its own conversation, told the directive to work its loop.
	const start = async (
		ids: string[],
		chosen: string[],
		reps: number,
	): Promise<void> => {
		if (feed === null || ids.length === 0) {
			return;
		}
		setRunning(null);
		setPending(true);
		setError(null);
		let last = "";
		let count = 0;
		try {
			for (const id of ids) {
				const existing = loops.get(id);
				if (existing !== undefined) {
					last = existing.id;
					count += 1;
					continue;
				}
				const text = scenarioPrompt(
					id,
					undefined,
					chosen.length === targets.length ? [] : chosen,
					reps === DEFAULT_REPS ? null : reps,
				);
				const state = await startAutoPick({ words: text, task: null });
				feed.put(state);
				const sending = feed.send(state.id, text);
				void promptConversation(state.id, text, [], false, sending.id)
					.then((reply) => feed.answered(state.id, sending, reply))
					.catch((failed: unknown) => feed.refused(state.id, sending, failed));
				last = state.id;
				count += 1;
			}
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		}
		setPending(false);
		setPicked([]);
		// One conversation is the one to watch; several are found in the list.
		if (count === 1) {
			location.hash = `conversations/${last}`;
		}
	};
	return (
		<section aria-label="scenarios" className="flex min-w-0 flex-col gap-4">
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{scenarios === null ? (
				error === null && <ReadingNow label="Reading scenarios…" />
			) : scenarios.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					This project lists no eval scenarios.
				</p>
			) : (
				<>
					<div className="flex flex-col gap-2">
						<h2 className="font-semibold text-lg tracking-tight">
							{summaryOf(rows)}
						</h2>
						<div
							role="progressbar"
							aria-label="scenarios passing"
							aria-valuemin={0}
							aria-valuemax={rows.length}
							aria-valuenow={counts.passing}
							className="h-2 overflow-hidden rounded-full bg-muted"
						>
							<div
								className="h-full bg-emerald-500"
								style={{ width: `${(counts.passing / rows.length) * 100}%` }}
							/>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{STATES.map((each) => (
							<button
								key={each}
								type="button"
								aria-pressed={filter.state === each}
								onClick={() =>
									setFilter({
										...filter,
										state: filter.state === each ? null : each,
									})
								}
								className={cn(
									"inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs",
									filter.state === each
										? "border-foreground bg-accent"
										: "hover:bg-accent/50",
								)}
							>
								{STATE_LABEL[each]}
								<span className="tabular-nums">{counts[each]}</span>
							</button>
						))}
						{projects.length > 1 && (
							<select
								aria-label="Filter by project"
								value={filter.project ?? ""}
								onChange={(event) =>
									setFilter({
										...filter,
										project:
											event.currentTarget.value === ""
												? null
												: event.currentTarget.value,
									})
								}
								className="h-7 rounded-md border bg-background px-2 text-xs"
							>
								<option value="">All projects</option>
								{projects.map((each) => (
									<option key={each} value={each}>
										{each}
									</option>
								))}
							</select>
						)}
						{picked.length > 0 && (
							<Button
								size="sm"
								className="ml-auto min-h-9"
								disabled={feed === null || pending}
								onClick={() => runOrOpen(picked)}
							>
								Run {picked.length} selected
							</Button>
						)}
					</div>
					{next !== undefined && (
						<NextUp
							row={next}
							onRun={runOrOpen}
							label={
								loops.has(next.scenario.id)
									? loopLabel(loops.get(next.scenario.id))
									: undefined
							}
						/>
					)}
					<div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
						<table className="block w-full text-sm md:table">
							<thead className="hidden md:table-header-group">
								<tr className="border-b text-left text-muted-foreground text-xs">
									<th className="w-8 py-2 pl-3" />
									<th className="py-2 pr-3">Scenario</th>
									<th className="py-2 pr-3">State</th>
									{saved.map((pick) => (
										<th key={targetOf(pick)} className="py-2 pr-3 font-normal">
											{pickName(pick)}
										</th>
									))}
									<th className="py-2 pr-3">Last run</th>
									<th className="py-2 pr-3" />
								</tr>
							</thead>
							<tbody className="block md:table-row-group">
								{shown.length === 0 && (
									<tr className="block md:table-row">
										<td
											colSpan={5 + saved.length}
											className="block py-4 text-center text-muted-foreground md:table-cell"
										>
											No scenario matches this filter.
										</td>
									</tr>
								)}
								{shown.map(({ scenario, state }) => (
									<Fragment key={scenario.id}>
										<tr className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-3 last:border-b-0 hover:bg-accent/30 md:table-row md:p-0">
											<td className="md:table-cell md:py-2 md:pl-3">
												<Checkbox
													aria-label={`Select ${scenario.id}`}
													checked={picked.includes(scenario.id)}
													onCheckedChange={() => toggle(scenario.id)}
												/>
											</td>
											<td className="min-w-0 flex-1 md:table-cell md:py-2 md:pr-3">
												<button
													type="button"
													aria-expanded={open === scenario.id}
													aria-label={`History of ${scenario.id}`}
													onClick={() =>
														setOpen(open === scenario.id ? null : scenario.id)
													}
													className="flex items-center gap-1 text-left font-medium break-words"
												>
													{open === scenario.id ? (
														<ChevronDownIcon className="size-3.5" />
													) : (
														<ChevronRightIcon className="size-3.5" />
													)}
													{scenario.id}
												</button>
											</td>
											<td
												aria-hidden
												className="order-1 h-0 basis-full md:hidden"
											/>
											<td className="order-2 md:table-cell md:py-2 md:pr-3">
												<span
													className={cn(
														"inline-flex h-5 items-center rounded-full px-2 font-medium text-xs whitespace-nowrap",
														STATE_TONE[state.state],
													)}
												>
													{STATE_LABEL[state.state]}
												</span>
											</td>
											{saved.map((pick) => (
												<td
													key={targetOf(pick)}
													className="order-2 text-xs tabular-nums md:table-cell md:py-2 md:pr-3 md:text-sm"
												>
													<span className="text-muted-foreground md:hidden">
														{pickName(pick)}{" "}
													</span>
													{passCount(state, targetOf(pick)) ?? "n/a"}
												</td>
											))}
											<td className="order-2 text-muted-foreground text-xs md:table-cell md:py-2 md:pr-3">
												{state.lastRunAt === null
													? "never"
													: new Date(state.lastRunAt).toLocaleString()}
											</td>
											<td className="order-1 md:table-cell md:py-2 md:pr-3 md:text-right">
												<Button
													size="sm"
													variant="outline"
													className="min-h-9"
													aria-label={`${loops.has(scenario.id) ? "Open loop for" : "Run"} ${scenario.id}`}
													disabled={feed === null || pending}
													onClick={() => runOrOpen([scenario.id])}
												>
													<PlayIcon />
													{loops.has(scenario.id)
														? loopLabel(loops.get(scenario.id))
														: "Run"}
												</Button>
											</td>
										</tr>
										{open === scenario.id && (
											<tr className="block border-b bg-muted/30 px-3 py-3 md:table-row md:p-0">
												<td className="hidden md:table-cell" />
												<td
													colSpan={4 + saved.length}
													className="block md:table-cell md:py-3 md:pr-3"
												>
													<ScenarioHistory
														scenario={scenario}
														onOpenBatch={onOpenBatch}
													/>
												</td>
											</tr>
										)}
									</Fragment>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
			<RunDialog
				ids={running}
				targets={targets}
				onCancel={() => setRunning(null)}
				onStart={(chosen, reps) => void start(running ?? [], chosen, reps)}
			/>
		</section>
	);
}

/** The worst failing scenario with the judge's reason, and the button to run it. */
function NextUp({
	label,
	row,
	onRun,
}: {
	label?: string;
	row: { scenario: EvalScenario; state: EvalScenarioState };
	onRun: (ids: string[]) => void;
}): JSX.Element {
	const [reason, setReason] = useState<string | null>(null);
	const run = row.state.run;
	useEffect(() => {
		let current = true;
		setReason(null);
		if (run !== null) {
			evalRun(run).then(
				(detail) => current && setReason(detail.judge?.reason ?? null),
				() => {},
			);
		}
		return () => {
			current = false;
		};
	}, [run]);
	return (
		<section
			aria-label="next up"
			className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
		>
			<div className="flex min-w-0 flex-col gap-1">
				<span className="text-muted-foreground text-xs uppercase">Next up</span>
				<span className="font-medium text-sm">{row.scenario.id}</span>
				{reason !== null && (
					<p className="line-clamp-3 text-muted-foreground text-xs">{reason}</p>
				)}
			</div>
			<Button
				size="sm"
				className="min-h-9 shrink-0"
				aria-label={`${label ? "Open loop for" : "Run"} next up ${row.scenario.id}`}
				onClick={() => onRun([row.scenario.id])}
			>
				{label ?? "Run"}
			</Button>
		</section>
	);
}

/** An agent's column name: its agent, model and effort. */
function pickName(pick: {
	agent: string;
	model?: string;
	effort?: string;
}): string {
	return [pick.agent, pick.model, pick.effort].filter(Boolean).join(" ");
}
