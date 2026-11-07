import {
	DEFAULT_EVAL_BUDGET,
	type EvalScenario,
	type EvalScenarioState,
	targetOf,
} from "@splates/server/evals/browser";
import { useReactive } from "core/react";
import { Duration } from "core/time";
import { ArrowLeftIcon, PlayIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { cn } from "#web/lib/utils.ts";
import { evalScenarios, evalStates } from "./api";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { ReadingNow } from "./countdown";
import { type EvalAgentsEditor, runAgentsOf } from "./eval-agents";
import { EvalAgentsView } from "./eval-agents-view";
import { scenarioPrompt } from "./eval-improve";
import { useEvalLoops } from "./eval-loops";
import {
	DEFAULT_REPS,
	EvalPlanPreview,
	type RunChoice,
	validRunChoice,
} from "./eval-plan-preview";
import { EvalRunSettings } from "./eval-run-settings";
import { EvalGroupCard } from "./eval-scenario-group-card";
import { EvalScenarioRow } from "./eval-scenario-row";
import {
	countStates,
	filterRows,
	groupRows,
	projectsOf,
	rowsOf,
	type ScenarioFilter,
	STATE_LABEL,
	STATES,
	summaryOf,
} from "./eval-scenarios";
import { useNow } from "./hooks/use-now";

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
}: {
	/** The saved eval agents: the ones a run card ticks. */
	agents: EvalAgentsEditor;
	onOpenBatch: (batch: string) => void;
	/** Where a conversation started from here is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
	/** Called once the scenarios have been read. */
	onLoaded?: () => void;
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
	const [collapsed, setCollapsed] = useState<string[]>([]);
	const [running, setRunning] = useState<string[] | null>(null);
	const [pending, setPending] = useState(false);
	// This run's own agents, copied from the saved ones when the review opens.
	const [runAgents, setRunAgents] = useState<EvalAgentsEditor | null>(null);
	const [choice, setChoice] = useState<RunChoice>({
		agents: [],
		reps: DEFAULT_REPS,
		limits: { ...DEFAULT_EVAL_BUDGET },
	});
	const now = useNow(true, Duration.mins(1));
	const saved = useReactive(agents, (each) => each.picks, ["changed"]);
	const runPicks = useReactive(runAgents ?? agents, (each) => each.picks, [
		"changed",
	]);
	const targets = (runAgents === null ? saved : runPicks).map(targetOf);
	const currentChoice = { ...choice, agents: targets };
	const loops = useEvalLoops(feed);
	const runOrOpen = (ids: string[]): void => {
		const loop = ids.length === 1 ? loops.get(ids[0] ?? "") : undefined;
		if (loop !== undefined) {
			location.hash = `conversations/${loop.id}`;
		} else {
			setRunAgents(runAgentsOf(agents));
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
	const groups = groupRows(shown);
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
			<div hidden={running !== null} className="flex flex-col gap-4">
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
						<div className="flex flex-col gap-3.5">
							{groups.length === 0 && (
								<p className="py-4 text-center text-muted-foreground text-sm">
									No scenario matches this filter.
								</p>
							)}
							{groups.map((group) => (
								<EvalGroupCard
									key={group.name}
									group={group}
									collapsed={collapsed.includes(group.name)}
									picked={picked}
									onToggle={() =>
										setCollapsed((now) =>
											now.includes(group.name)
												? now.filter((each) => each !== group.name)
												: [...now, group.name],
										)
									}
									onPick={(ids, on) =>
										setPicked((now) =>
											on
												? [...new Set([...now, ...ids])]
												: now.filter((id) => !ids.includes(id)),
										)
									}
								>
									{group.rows.map(({ scenario, state }) => (
										<EvalScenarioRow
											key={scenario.id}
											scenario={scenario}
											state={state}
											isPicked={picked.includes(scenario.id)}
											isOpen={open === scenario.id}
											loop={loops.get(scenario.id)}
											now={now}
											saved={saved}
											onOpenBatch={onOpenBatch}
											onPick={() => toggle(scenario.id)}
											onOpen={() =>
												setOpen(open === scenario.id ? null : scenario.id)
											}
											onOpenLoop={() => runOrOpen([scenario.id])}
										/>
									))}
								</EvalGroupCard>
							))}
						</div>
					</>
				)}
			</div>
			{running !== null && runAgents !== null && (
				<>
					<EvalAgentsView editor={runAgents} />
					<EvalPlanPreview
						ids={running}
						existing={new Set(loops.keys())}
						choice={currentChoice}
					/>
				</>
			)}
			<div className="sticky bottom-0 -mx-1 flex flex-col gap-3 bg-background/90 px-1 py-3 backdrop-blur">
				{running === null ? (
					<Button
						className="min-h-11 w-full"
						disabled={feed === null || pending || picked.length === 0}
						onClick={() => runOrOpen(picked)}
					>
						{picked.length > 0
							? `Review ${picked.length} ${picked.length === 1 ? "scenario" : "scenarios"}`
							: "Choose scenarios to run"}
					</Button>
				) : (
					<>
						<EvalRunSettings choice={currentChoice} onChange={setChoice} />
						<div className="flex gap-2">
							<Button
								variant="outline"
								className="min-h-11"
								disabled={pending}
								onClick={() => {
									setRunning(null);
								}}
							>
								<ArrowLeftIcon />
								Back
							</Button>
							<Button
								className="min-h-11 flex-1"
								disabled={pending || !validRunChoice(currentChoice)}
								onClick={() =>
									void start(running, currentChoice.agents, currentChoice)
								}
							>
								<PlayIcon />
								{pending ? "Starting…" : "Accept and start evals"}
							</Button>
						</div>
					</>
				)}
			</div>
		</section>
	);
}
