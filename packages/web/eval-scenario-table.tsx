import {
	type EvalScenario,
	type EvalScenarioState,
	targetOf,
} from "@splates/server/evals/browser";
import { useReactive } from "core/react";
import { Duration } from "core/time";
import { ArrowLeftIcon, PlayIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { evalScenarios, evalStates } from "./api";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { ReadingNow } from "./countdown";
import { type EvalAgentsEditor, runAgentsOf } from "./eval-agents";
import { EvalAgentsView } from "./eval-agents-view";
import { EvalFileList } from "./eval-file-list";
import { byNamespace, scenarioPrompt } from "./eval-improve";
import { useEvalLoops } from "./eval-loops";
import {
	DEFAULT_REPS,
	EvalPlanPreview,
	type RunChoice,
	validRunChoice,
} from "./eval-plan-preview";
import { EvalGroupCard, EvalSuite } from "./eval-scenario-group-card";
import { EvalScenarioRow } from "./eval-scenario-row";
import {
	countStates,
	fileKeyOf,
	filesOf,
	filterRows,
	rowsOf,
	type ScenarioFilter,
	type ScenarioRow,
	STATES,
	suitesOf,
	summaryOf,
} from "./eval-scenarios";
import { FileChip } from "./file-chip";
import { useNow } from "./hooks/use-now";

/** What a state's filter pill reads, and its colors. */
const PILL: Record<
	ScenarioFilter["state"] & string,
	{ label: string; tone: string }
> = {
	failing: { label: "failing", tone: "bg-destructive/15 text-destructive" },
	"needs-runs": {
		label: "need runs",
		tone: "bg-warning/15 text-warning",
	},
	"never-run": { label: "not run", tone: "bg-muted text-muted-foreground" },
	passing: {
		label: "passing",
		tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
	},
};

/**
 * Browse the specs the project lists: with no file open, its eval files as
 * one card, a row a file; with `file` open, that file's specs as suites and
 * their `describe` groups, one sentence a spec, each group its own card. Open
 * a spec to see its prompt and latest results. Pass feed so Run can start a
 * conversation to work the picked specs' loop. Browsing costs nothing. Pass
 * onLoaded to learn when the specs have been read.
 */
export function EvalScenarioTable({
	agents,
	file = null,
	feed = null,
	onLoaded,
}: {
	/** The eval file open, as its address names it; null for the list of files. */
	file?: string | null;
	/** The saved eval agents: the ones a run card ticks. */
	agents: EvalAgentsEditor;
	/** Where a conversation started from here is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
	/** Called once the scenarios have been read. */
	onLoaded?: () => void;
}): JSX.Element {
	const [scenarios, setScenarios] = useState<EvalScenario[] | null>(null);
	const [states, setStates] = useState<EvalScenarioState[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<ScenarioFilter>({ state: null });
	const [picked, setPicked] = useState<string[]>([]);
	const [open, setOpen] = useState<string | null>(null);
	const [running, setRunning] = useState<string[] | null>(null);
	const [pending, setPending] = useState(false);
	// This run's own agents, copied from the saved ones when the review opens.
	const [runAgents, setRunAgents] = useState<EvalAgentsEditor | null>(null);
	const now = useNow(true, Duration.mins(1));
	const saved = useReactive(agents, (each) => each.picks, ["changed"]);
	const runPicks = useReactive(runAgents ?? agents, (each) => each.picks, [
		"changed",
	]);
	const targets = (runAgents === null ? saved : runPicks).map(targetOf);
	// Repetitions start at their defaults; each conversation changes its own.
	const currentChoice: RunChoice = {
		agents: targets,
		reps: DEFAULT_REPS,
	};
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
	const rows = rowsOf(
		(scenarios ?? []).filter(
			(each) => file === null || fileKeyOf(each) === file,
		),
		states,
	);
	const counts = countStates(rows);
	const shown = filterRows(rows, filter);
	const suites = suitesOf(shown);
	const at =
		rows.find((row) => row.scenario.fileAt !== undefined)?.scenario.fileAt ??
		null;
	const pick = (ids: string[], on: boolean): void =>
		setPicked((now) =>
			on
				? [...new Set([...now, ...ids])]
				: now.filter((id) => !ids.includes(id)),
		);
	const specRow = ({ scenario, state }: ScenarioRow) => (
		<EvalScenarioRow
			key={scenario.id}
			scenario={scenario}
			state={state}
			isPicked={picked.includes(scenario.id)}
			isOpen={open === scenario.id}
			loop={loops.get(scenario.id)}
			now={now}
			onPick={() => toggle(scenario.id)}
			onOpen={() => setOpen(open === scenario.id ? null : scenario.id)}
			onOpenLoop={() => runOrOpen([scenario.id])}
		/>
	);
	const toggle = (id: string): void =>
		setPicked((now) =>
			now.includes(id) ? now.filter((each) => each !== id) : [...now, id],
		);
	// Each namespace's scenarios share one conversation, told the directive to work its loop.
	const start = async (
		ids: string[],
		chosen: string[],
		{ reps }: Pick<RunChoice, "reps">,
	): Promise<void> => {
		if (feed === null || ids.length === 0) {
			return;
		}
		setPending(true);
		setError(null);

		let count = 0;
		try {
			for (const group of byNamespace(ids)) {
				const fresh = group.filter((id) => !loops.has(id));
				count += group.length - fresh.length;
				if (fresh.length === 0) {
					continue;
				}
				const text = scenarioPrompt(
					fresh,
					chosen,
					reps === DEFAULT_REPS ? null : reps,
				);
				const state = await startAutoPick({ words: text, task: null });
				feed.put(state);
				const sending = feed.send(state.id, text);
				void promptConversation(state.id, text, [], false, sending.id)
					.then((reply) => feed.answered(state.id, sending, reply))
					.catch((failed: unknown) => feed.refused(state.id, sending, failed));

				count += fresh.length;
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
					error === null && <ReadingNow label="Reading specs…" />
				) : scenarios.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						This project lists no eval specs.
					</p>
				) : rows.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						This project lists no specs in {file}.
					</p>
				) : (
					<>
						{file !== null && at !== null && (
							<FileChip
								path={at}
								name="Open in editor"
								className="hidden w-fit sm:flex"
							/>
						)}
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="mr-1 font-semibold text-lg tracking-tight">
								{summaryOf(rows)}
							</h2>
							{STATES.filter((each) => counts[each] > 0).map((each) => (
								<button
									key={each}
									type="button"
									aria-pressed={filter.state === each}
									aria-label={`Show only ${PILL[each].label}`}
									onClick={() =>
										setFilter({ state: filter.state === each ? null : each })
									}
									className={cn(
										"inline-flex h-6 items-center rounded-full px-2.5 font-medium text-xs tabular-nums",
										PILL[each].tone,
										filter.state === each &&
											"ring-2 ring-foreground/60 ring-offset-1 ring-offset-background",
									)}
								>
									{counts[each]} {PILL[each].label}
								</button>
							))}
						</div>
						{file === null ? (
							<EvalFileList files={filesOf(shown)} />
						) : (
							<div className="flex flex-col gap-8">
								{suites.map((suite) => (
									<EvalSuite
										key={suite.name}
										name={suite.name}
										rows={suite.rows}
										picked={picked}
										onPick={pick}
									>
										{suite.loose.length > 0 && (
											<EvalGroupCard
												name={null}
												rows={suite.loose}
												picked={picked}
												onPick={pick}
											>
												{suite.loose.map(specRow)}
											</EvalGroupCard>
										)}
										{suite.groups.map((group) => (
											<EvalGroupCard
												key={group.name}
												name={group.name}
												rows={group.rows}
												picked={picked}
												onPick={pick}
											>
												{group.rows.map(specRow)}
											</EvalGroupCard>
										))}
									</EvalSuite>
								))}
							</div>
						)}
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
			<div
				hidden={file === null}
				className="sticky bottom-0 -mx-1 flex flex-col gap-3 bg-background/90 px-1 py-3 backdrop-blur"
			>
				{running === null ? (
					<Button
						block
						disabled={feed === null || pending || picked.length === 0}
						onClick={() => runOrOpen(picked)}
					>
						{picked.length > 0
							? `Review ${picked.length} ${picked.length === 1 ? "spec" : "specs"}`
							: "Pick specs to run"}
					</Button>
				) : (
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
				)}
			</div>
		</section>
	);
}
