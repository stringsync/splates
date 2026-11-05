import {
	DEFAULT_EVAL_BUDGET,
	type EvalScenario,
	type EvalScenarioState,
	type EvalScenarioStatus,
	targetOf,
} from "@splates/server/evals/browser";
import { useReactive } from "core/react";
import { Duration } from "core/time";
import {
	ArrowLeftIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	PlayIcon,
} from "lucide-react";
import { Fragment, type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { cn } from "#web/lib/utils.ts";
import { evalScenarios, evalStates } from "./api";
import { Progress } from "./components/ui/progress";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { ReadingNow } from "./countdown";
import type { EvalAgentsEditor } from "./eval-agents";
import { EvalAgentsView } from "./eval-agents-view";
import { scenarioPrompt } from "./eval-improve";
import { loopLabel, useEvalLoops } from "./eval-loops";
import { NextUp } from "./eval-next-up";
import {
	DEFAULT_REPS,
	EvalPlanPreview,
	type RunChoice,
	validRunChoice,
} from "./eval-plan-preview";
import { EvalRunSettings } from "./eval-run-settings";
import { ScenarioDetails } from "./eval-scenario-details";
import {
	countStates,
	filterRows,
	projectsOf,
	rowsOf,
	type ScenarioFilter,
	STATE_LABEL,
	STATES,
	summaryOf,
} from "./eval-scenarios";
import { useNow } from "./hooks/use-now";
import { ago } from "./plan-limits";

const STATE_TONE: Record<EvalScenarioStatus, string> = {
	failing: "bg-destructive/15 text-destructive",
	"never-run": "bg-muted text-muted-foreground",
	passing: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

/**
 * Browse every scenario the project lists, worst first, each by its name and
 * what it tests, and filter by state or project. Open a row to see its prompt,
 * how it is judged and its last run; pass feed so Run can
 * start a conversation to work the scenario's loop. Browsing costs nothing.
 * Pass onLoaded to learn when the scenarios have been read.
 */
export function EvalScenarioTable({
	agents,
	onOpenBatch,
	feed = null,
	onLoaded,
	onStarted,
}: {
	/** The saved eval agents: the ones a run card ticks. */
	agents: EvalAgentsEditor;
	onOpenBatch: (batch: string) => void;
	/** Where a conversation started from here is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
	/** Called once the scenarios have been read. */
	onLoaded?: () => void;
	/** Called after starting the plan, to show its conversations. */
	onStarted?: () => void;
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
	const [choice, setChoice] = useState<RunChoice>({
		agents: [],
		reps: DEFAULT_REPS,
		limits: { ...DEFAULT_EVAL_BUDGET },
	});
	const [review, setReview] = useState<RunChoice | null>(null);
	const now = useNow(true, Duration.mins(1));
	const saved = useReactive(agents, (each) => each.picks, ["changed"]);
	const targets = saved.map(targetOf);
	const currentChoice = { ...choice, agents: targets };
	const loops = useEvalLoops(feed);
	const runOrOpen = (ids: string[]): void => {
		const loop = ids.length === 1 ? loops.get(ids[0] ?? "") : undefined;
		if (loop !== undefined) {
			location.hash = `conversations/${loop.id}`;
		} else {
			setRunning(ids);
			setReview({ ...currentChoice, agents: [...targets] });
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
				onLoaded?.();
			}
		}, fail);
		return () => {
			current = false;
		};
	}, [onLoaded]);
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
		{ reps, limits }: Pick<RunChoice, "reps" | "limits">,
	): Promise<void> => {
		if (feed === null || ids.length === 0) {
			return;
		}
		setPending(true);
		setError(null);

		let count = 0;
		try {
			for (const id of ids) {
				const existing = loops.get(id);
				if (existing !== undefined) {
					count += 1;
					continue;
				}
				const text = scenarioPrompt(
					id,
					limits,
					chosen,
					reps === DEFAULT_REPS ? null : reps,
				);
				const state = await startAutoPick({ words: text, task: null });
				feed.put(state);
				const sending = feed.send(state.id, text);
				void promptConversation(state.id, text, [], false, sending.id)
					.then((reply) => feed.answered(state.id, sending, reply))
					.catch((failed: unknown) => feed.refused(state.id, sending, failed));

				count += 1;
			}
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		}
		setPending(false);
		// Successful starts leave the selection; a partial failure can retry only what remains.
		if (count === ids.length) {
			setPicked([]);
			setRunning(null);
			setReview(null);
			onStarted?.();
		} else {
			setRunning(ids.slice(count));
			setPicked(ids.slice(count));
		}
	};
	return (
		<section aria-label="scenarios" className="flex min-w-0 flex-col gap-4">
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			<div className="flex flex-col gap-1.5">
				<div className="flex justify-between text-muted-foreground text-xs">
					<span>Step {running === null ? 1 : 2} of 3</span>
					<span className="text-foreground">
						{running === null ? "Choose scenarios" : "Review and accept"}
					</span>
				</div>
				<Progress
					value={running === null ? 1 : 2}
					max={3}
					aria-label="Eval step"
				/>
			</div>
			<div hidden={running !== null} className="flex flex-col gap-4">
				<EvalAgentsView editor={agents} />
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
							<span className="ml-auto flex items-center gap-2 text-xs">
								Select all
								<Checkbox
									aria-label="Select all scenarios"
									checked={
										shown.length > 0 &&
										shown.every(({ scenario }) => picked.includes(scenario.id))
									}
									onCheckedChange={(on) =>
										setPicked((now) =>
											on
												? [
														...new Set([
															...now,
															...shown.map(({ scenario }) => scenario.id),
														]),
													]
												: now.filter(
														(id) =>
															!shown.some(({ scenario }) => scenario.id === id),
													),
										)
									}
								/>
							</span>
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
										<th className="w-28 py-2 pr-3">State</th>
										<th className="w-24 py-2 pr-3 whitespace-nowrap">
											Last run
										</th>
										<th className="w-24 py-2 pr-4" />
									</tr>
								</thead>
								<tbody className="block md:table-row-group">
									{shown.length === 0 && (
										<tr className="block md:table-row">
											<td
												colSpan={5}
												className="block py-4 text-center text-muted-foreground md:table-cell"
											>
												No scenario matches this filter.
											</td>
										</tr>
									)}
									{shown.map(({ scenario, state }) => (
										<Fragment key={scenario.id}>
											<tr className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-3 last:border-b-0 hover:bg-accent/30 md:table-row md:p-0">
												<td className="md:table-cell md:py-3 md:pl-3 md:align-middle">
													<Checkbox
														aria-label={`Select ${scenario.id}`}
														checked={picked.includes(scenario.id)}
														onCheckedChange={() => toggle(scenario.id)}
													/>
												</td>
												<td className="min-w-0 flex-1 md:table-cell md:py-3 md:pr-3">
													<button
														type="button"
														aria-expanded={open === scenario.id}
														aria-label={`Details of ${scenario.id}`}
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
													{scenario.about !== null && (
														<p
															className={cn(
																"mt-0.5 ml-[1.125rem] text-muted-foreground text-xs",
																open !== scenario.id && "line-clamp-2",
															)}
														>
															{scenario.about}
														</p>
													)}
												</td>
												<td
													aria-hidden
													className="order-1 h-0 basis-full md:hidden"
												/>
												<td className="order-2 md:table-cell md:w-28 md:py-3 md:pr-3 md:align-middle">
													<span
														className={cn(
															"inline-flex h-5 items-center rounded-full px-2 font-medium text-xs whitespace-nowrap",
															STATE_TONE[state.state],
														)}
													>
														{STATE_LABEL[state.state]}
													</span>
												</td>
												<td
													title={
														state.lastRunAt === null
															? undefined
															: new Date(state.lastRunAt).toLocaleString()
													}
													className="order-2 text-muted-foreground text-xs whitespace-nowrap md:table-cell md:w-24 md:py-3 md:pr-3 md:align-middle"
												>
													{state.lastRunAt === null
														? "never"
														: ago(Date.parse(state.lastRunAt), now)}
												</td>
												<td className="order-1 md:table-cell md:w-24 md:py-3 md:pr-4 md:text-right md:align-middle">
													<Button
														size="sm"
														variant="outline"
														className="min-h-9 md:min-h-8"
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
														colSpan={4}
														className="block md:table-cell md:py-3 md:pr-3"
													>
														<ScenarioDetails
															scenario={scenario}
															state={state}
															saved={saved}
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
			</div>
			{running !== null && review !== null && (
				<EvalPlanPreview
					ids={running}
					existing={new Set(loops.keys())}
					choice={review}
				/>
			)}
			<div className="sticky bottom-0 -mx-1 flex flex-col gap-3 bg-background/90 px-1 py-3 backdrop-blur">
				{running === null ? (
					<>
						<EvalRunSettings choice={currentChoice} onChange={setChoice} />
						<Button
							className="min-h-11 w-full"
							disabled={
								feed === null ||
								pending ||
								picked.length === 0 ||
								!validRunChoice(currentChoice)
							}
							onClick={() => runOrOpen(picked)}
						>
							{picked.length > 0
								? `Review ${picked.length} ${picked.length === 1 ? "scenario" : "scenarios"}`
								: "Choose scenarios to run"}
						</Button>
					</>
				) : (
					<div className="flex gap-2">
						<Button
							variant="outline"
							className="min-h-11"
							disabled={pending}
							onClick={() => {
								setRunning(null);
								setReview(null);
							}}
						>
							<ArrowLeftIcon />
							Back
						</Button>
						<Button
							className="min-h-11 flex-1"
							disabled={pending || review === null || !validRunChoice(review)}
							onClick={() =>
								review !== null && void start(running, review.agents, review)
							}
						>
							<PlayIcon />
							{pending ? "Starting…" : "Accept and start evals"}
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}
