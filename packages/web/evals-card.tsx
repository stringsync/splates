import { useAuiState } from "@assistant-ui/react";
import {
	type EvalGrid,
	type EvalScenario,
	fitsEvalBudget,
	targetOf,
} from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";
import type { PermissionProposal } from "@splates/server/plans";
import { useReactive } from "core/react";
import {
	CheckIcon,
	ChevronRightIcon,
	FlaskConicalIcon,
	SquareIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { CardBody, CardShell } from "./card-shell";
import { EvalProgress, EvalRunRecord } from "./eval-card-record";
import { EvalRun } from "./eval-run";
import {
	doneAsideText,
	EvalSpecResults,
	targetDisplay,
} from "./eval-spec-results";
import { plannedCells } from "./eval-squares";
import { ceilCents, dollars } from "./eval-status";
import { Markdown } from "./markdown";
import { MergeCardContext } from "./merge-card";
import { Refusal } from "./refusal";

const _RUN_AGENTS =
	"The agents these scenarios run on, each at the model and thinking level shown. Changes here are for this run only.";

/** The conversation the card is in, which the server tells once its run is done; null outside one. */
export const EvalsConversation = createContext<string | null>(null);

/**
 * An agent's round of evals: waiting, running and done are one card. The
 * server starts it by itself when its ceiling fits what is left of the
 * conversation's approved eval budget, so the card has nothing to press but
 * Stop. Before it runs it lists the targeted specs as sentences and, when
 * the budget falls short, says it waits for one; while running it shows live
 * progress; once done it lists every test as a row opening to Prompt,
 * Results by model, Where it failed, Diagnosis and remedy.
 */
export function EvalsCard({
	proposal,
	round,
	earlierRound = false,
}: {
	proposal: PermissionProposal;
	/** 1-based round number in the conversation, when known. */
	round?: number;
	/** Whether a later eval round follows in the conversation; folds unrun rounds while keeping finished ones open. */
	earlierRound?: boolean;
}): JSX.Element {
	const conversation = useContext(EvalsConversation);
	const task = useContext(MergeCardContext)?.task ?? null;
	const message = useAuiState((state) => state.message.id);
	const [run] = useState(() => EvalRun.of(proposal, { conversation, message }));
	useEffect(() => {
		void run.load();
		return () => run.dispose();
	}, [run]);
	const state = useReactive(
		run,
		(each) => ({
			picks: each.picks,
			scenarios: each.scenarios,
			allScenarios: each.allScenarios,
			unknown: each.unknown,
			unknownAgents: each.unknownAgents,
			plan: each.plan,
			budget: each.budget,
			launch: each.launch,
			grid: each.grid,
			refusal: each.refusal,
			loaded: each.loaded,
			running: each.running,
		}),
		["changed"],
	);
	const { launch, grid } = state;
	const runBegan = useRef<string | null>(null);
	if (state.running && grid === null) {
		runBegan.current ??= new Date().toISOString();
	} else if (!state.running) {
		runBegan.current = null;
	}
	const ceiling =
		state.plan !== null && !state.plan.refused ? state.plan.usd : null;
	const waiting = state.loaded && launch === null;
	// A round whose ceiling does not fit what is left waits for a budget card.
	const short =
		waiting &&
		state.budget !== null &&
		ceiling !== null &&
		!fitsEvalBudget(state.budget.usd, state.budget.spent, ceiling);
	const runs = state.scenarios.length * state.picks.length * run.reps;
	const liveGrid =
		grid ??
		(state.running && state.picks.length > 0 && state.scenarios.length > 0
			? startingGrid(
					run.ask.skill,
					state.scenarios.map((each) => each.id),
					state.picks,
					run.reps,
					runBegan.current ?? new Date().toISOString(),
				)
			: null);
	const roundSuffix = round !== undefined ? ` · round ${round}` : "";
	const title =
		launch === null
			? `Run ${run.ask.skill} evals${round !== undefined && round > 1 ? ` · round ${round}` : ""}`
			: state.running
				? `Running evals${roundSuffix}`
				: launch.status === "refused"
					? `Evals refused${roundSuffix}`
					: launch.status === "stopped"
						? `Evals stopped${roundSuffix}`
						: `Evals done${roundSuffix}`;
	const done = !state.running && launch !== null && liveGrid !== null;
	const untargeted = state.allScenarios.filter(
		(each) => !run.ask.scenarios.includes(each.id),
	);
	const left =
		state.budget === null
			? 0
			: Math.max(0, state.budget.usd - state.budget.spent);
	return (
		<CardShell
			label={`run evals ${run.ask.skill}`}
			Icon={FlaskConicalIcon}
			title={title}
			tone="eval"
			task={task?.task}
			base={task?.base ?? null}
			folded={waiting && earlierRound}
			aside={
				state.running && liveGrid !== null && launch !== null ? (
					<EvalProgress grid={liveGrid} running />
				) : done ? (
					<span className="text-muted-foreground text-xs tabular-nums">
						{doneAsideText(liveGrid)}
					</span>
				) : waiting && earlierRound ? (
					<span className="text-muted-foreground text-xs">Not run</span>
				) : short ? (
					<span className="text-warning text-xs">Waiting for a budget</span>
				) : waiting && ceiling !== null ? (
					<span className="text-muted-foreground text-xs tabular-nums">
						up to ${ceilCents(ceiling).toFixed(2)}
					</span>
				) : undefined
			}
		>
			{!done && proposal.body !== "" && <CardBody text={proposal.body} />}
			{state.running && liveGrid !== null ? (
				<div className="mx-4 mb-3 flex flex-col gap-2">
					<p className="m-0 flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-sm">
						<span>
							{state.picks.length}{" "}
							{state.picks.length === 1 ? "agent" : "agents"}
						</span>
						<span aria-hidden>·</span>
						<span data-testid="reps" className="tabular-nums">
							{run.reps} {run.reps === 1 ? "rep" : "reps"}
						</span>
						<span aria-hidden>·</span>
						<span className="tabular-nums">
							{runs} {runs === 1 ? "run" : "runs"}
						</span>
					</p>
					<EvalRunRecord
						grid={liveGrid}
						running={state.running}
						stopped={launch?.status === "stopped"}
						shape={false}
						leftOut={run.ask.leftOut}
					/>
				</div>
			) : done ? (
				<EvalSpecResults
					grid={liveGrid}
					scenarios={state.scenarios}
					skill={run.ask.skill}
				/>
			) : launch !== null ? (
				launch.output !== "" && (
					<pre className="mx-4 my-3 whitespace-pre-wrap text-muted-foreground text-sm">
						{launch.output}
					</pre>
				)
			) : (
				<div className="flex flex-col gap-2">
					<RequestSpecList
						skill={run.ask.skill}
						targetLabel={proposal.title}
						targeted={
							state.scenarios.length > 0
								? state.scenarios
								: run.ask.scenarios.map((id) => ({
										id,
										group: null,
										about: null,
									}))
						}
						untargeted={untargeted}
						total={
							state.allScenarios.length > 0
								? state.allScenarios.length
								: run.ask.scenarios.length
						}
					/>
					{state.unknown.length > 0 && (
						<p className="mx-4 text-destructive text-sm">
							Not a scenario: {state.unknown.join(", ")}
						</p>
					)}
					{state.unknownAgents.length > 0 && (
						<p className="mx-4 text-muted-foreground text-sm">
							Not a saved agent, so left out: {state.unknownAgents.join(", ")}
						</p>
					)}
					{state.plan !== null &&
						(state.plan.refused || state.plan.usd === null) &&
						state.plan.output !== "" && (
							<p className="mx-4 mb-2 text-muted-foreground text-sm">
								{state.plan.output}
							</p>
						)}
				</div>
			)}
			{short && !earlierRound && state.budget !== null && ceiling !== null && (
				<p role="status" className="mx-4 mb-3 text-muted-foreground text-xs">
					{state.budget.usd === 0
						? "No eval budget is approved in this conversation yet."
						: `${dollars(left)} of the ${dollars(state.budget.usd)} eval budget is left.`}{" "}
					This round may cost up to ${ceilCents(ceiling).toFixed(2)}; it starts
					once a budget card covers it.
				</p>
			)}
			{(waiting || state.running) && !earlierRound && (
				<div className="flex flex-wrap items-center gap-2 rule-t px-4 py-2.5">
					<span className="mr-auto flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs">
						<span className="mr-0.5">Agents</span>
						{state.picks.map((pick) => {
							const { markAgent, label } = targetDisplay({
								key: targetOf(pick),
								agent: pick.agent,
								model: pick.model ?? null,
								effort: pick.effort ?? null,
								skill: null,
							});
							return (
								<span
									key={targetOf(pick)}
									className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-foreground text-xs"
								>
									<AgentMark agent={markAgent} className="size-3.5 shrink-0" />
									<span>{label}</span>
								</span>
							);
						})}
						<span aria-hidden>·</span>
						<span data-testid="reps" className="tabular-nums">
							{run.reps} {run.reps === 1 ? "rep" : "reps"}
						</span>
						{run.ask.baseline !== null && (
							<>
								<span aria-hidden>·</span>
								<span>
									baseline{" "}
									<code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
										{run.ask.baseline}
									</code>
								</span>
							</>
						)}
					</span>
					{ceiling !== null && (
						<span
							data-testid="plan"
							className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums"
						>
							Up to{" "}
							<span className="font-semibold text-foreground">
								${ceilCents(ceiling).toFixed(2)}
							</span>
						</span>
					)}
					{state.running && (
						<Button
							size="sm"
							variant="outline"
							className="gap-1.5 in-data-sheet:h-11 in-data-sheet:flex-1 in-data-sheet:text-base"
							onClick={() => void run.stop()}
						>
							<SquareIcon data-icon="inline-start" />
							Stop
						</Button>
					)}
				</div>
			)}
			<Refusal refusal={state.refusal} className="mx-4 mb-3" />
		</CardShell>
	);
}

/**
 * The run request's targeted specs, listed as sentences with what targeted
 * them, plus a collapsible list of untargeted specs when only part of the
 * suite is targeted.
 */
function RequestSpecList({
	skill,
	targetLabel,
	targeted,
	untargeted,
	total,
}: {
	skill: string;
	targetLabel: string | null;
	targeted: readonly EvalScenario[];
	untargeted: readonly EvalScenario[];
	total: number;
}): JSX.Element {
	const [showOther, setShowOther] = useState(false);
	const grouped = new Map<string, EvalScenario[]>();
	for (const scenario of targeted) {
		const group = scenario.group ?? "";
		grouped.set(group, [...(grouped.get(group) ?? []), scenario]);
	}
	const chipText =
		targetLabel && targetLabel.trim() !== ""
			? targetLabel.trim()
			: [...grouped.keys()].filter(Boolean).join(", ");

	return (
		<div className="flex flex-col gap-2 px-4 pb-3.5 text-sm">
			{(chipText !== "" || total > targeted.length) && (
				<div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
					<span>Targets</span>
					{chipText !== "" && (
						<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">
							{chipText}
						</code>
					)}
					<span aria-hidden>·</span>
					<span className="tabular-nums">
						{targeted.length} of {total} {total === 1 ? "spec" : "specs"}
					</span>
				</div>
			)}
			<div className="flex flex-col gap-2">
				{[...grouped.entries()].map(([group, items]) => (
					<div key={group || "__ungrouped"} className="flex flex-col gap-1">
						{group !== "" && (
							<div className="text-muted-foreground text-xs">
								{skill} › {group}
							</div>
						)}
						<ul className="flex flex-col gap-1.5">
							{items.map((scenario) => (
								<li key={scenario.id} className="flex items-start gap-2.5">
									<span
										aria-hidden
										className="mt-0.5 inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px] bg-foreground text-background"
									>
										<CheckIcon className="size-2.5 stroke-[3]" />
									</span>
									<Markdown
										text={scenario.about || scenario.id}
										inline
										className="flex-1 text-[13.5px] leading-snug"
									/>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
			{untargeted.length > 0 && (
				<div className="pt-0.5">
					<button
						type="button"
						aria-expanded={showOther}
						onClick={() => setShowOther((was) => !was)}
						className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
					>
						<ChevronRightIcon
							aria-hidden
							className={cn(
								"size-3.5 transition-transform duration-150",
								showOther && "rotate-90",
							)}
						/>
						{untargeted.length} other{" "}
						{untargeted.length === 1 ? "spec" : "specs"} not targeted
					</button>
					{showOther && (
						<ul className="mt-1.5 flex flex-col gap-1 pl-5 text-muted-foreground text-xs">
							{untargeted.map((scenario) => (
								<li key={scenario.id} className="break-words">
									<Markdown text={scenario.about || scenario.id} inline />
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}

/** Planned grid shown right after Run until the runner creates its batch directory. */
function startingGrid(
	skill: string,
	scenarios: readonly string[],
	picks: readonly AgentPick[],
	reps: number,
	startedAt: string,
): EvalGrid {
	const targets = picks.map((pick) => ({
		key: targetOf(pick),
		agent: pick.agent,
		model: pick.model ?? null,
		effort: pick.effort ?? null,
		skill: null,
	}));
	const grid = plannedCells(
		scenarios,
		targets.map((target) => target.key),
		reps,
	);
	return {
		id: "",
		skill,
		producer: null,
		startedAt,
		targets,
		tally: { pending: grid.length },
		cells: grid.length,
		tokens: null,
		costUsd: null,
		results: [],
		grid,
	};
}
