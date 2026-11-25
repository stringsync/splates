import {
	type EvalGrid,
	FAULT_LAYERS,
	type FaultLayer,
	type Faults,
	faultsOf,
} from "@splates/server/evals/browser";
import type { EvalLeftOut } from "@splates/server/plans";
import type { JSX } from "react";
import { elapsedMs, formatElapsed, useSecondClock } from "./eval-elapsed";
import {
	linesOf,
	remarkList,
	runningCells,
	ScenarioSquares,
	type SquaresState,
} from "./eval-squares";
import { Markdown } from "./markdown";

/** A batch's agents, repetitions and runs: `3 agents · 2 reps · 18 runs`, as a card and report head their squares. */
export function gridShape(grid: EvalGrid): string {
	const reps = Math.max(1, ...grid.grid.map((cell) => cell.repetition + 1));
	const agents = grid.targets.length;
	const runs = grid.cells;
	return `${agents} ${agents === 1 ? "agent" : "agents"} · ${reps} ${reps === 1 ? "rep" : "reps"} · ${runs} ${runs === 1 ? "run" : "runs"}`;
}

/** The run's state for its squares. */
export function squaresState(
	grid: EvalGrid,
	running: boolean,
	stopped: boolean,
): SquaresState {
	return { running: runningCells(grid, running), stopped };
}

/** What sits beside a run's title: runs landed, time, and cost once any. */
export function progressText(
	grid: EvalGrid,
	running: boolean,
	clock: number,
): string {
	const landed = grid.cells - (grid.tally.pending ?? 0);
	const cost =
		grid.costUsd === null || grid.costUsd === 0
			? []
			: [`$${grid.costUsd.toFixed(2)}${running ? " so far" : ""}`];
	return [
		`${landed} of ${grid.cells}`,
		formatElapsed(elapsedMs(grid, running, clock)),
		...cost,
	].join(" · ");
}

/** A run's progress beside its title, its clock ticking while it runs. */
export function EvalProgress({
	grid,
	running,
}: {
	grid: EvalGrid;
	running: boolean;
}): JSX.Element {
	const clock = useSecondClock(running);
	return (
		<span
			role="timer"
			aria-label="progress"
			data-testid="eval-timer"
			className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums"
		>
			{progressText(grid, running, clock)}
		</span>
	);
}

/**
 * A run's results as the conversation keeps them: its shape, a row of squares
 * per scenario, the summary once it ends, and the report one click away.
 * Shows no agent's runs apart: those are the report's.
 */
export function EvalRunRecord({
	grid,
	running,
	stopped,
	shape = true,
	leftOut,
}: {
	grid: EvalGrid;
	running: boolean;
	stopped: boolean;
	/** Agents the asking agent left out of this round after they passed. */
	leftOut?: readonly EvalLeftOut[];
	/** Whether the shape line leads; off where the settings row already says it. */
	shape?: boolean;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			{shape && (
				<p className="flex min-h-6 items-center text-muted-foreground text-sm">
					{gridShape(grid)}
				</p>
			)}
			<ScenarioSquares
				lines={linesOf(
					grid.grid,
					grid.targets.map((target) => target.key),
				)}
				state={squaresState(grid, running, stopped)}
				leftOut={leftOut}
			/>
			{!running && <EvalSummary grid={grid} stopped={stopped} />}
		</div>
	);
}

/**
 * An ended run's summary in one line: the passes once, as runs when each
 * scenario ran once and as scenarios and runs when they differ, then what
 * else stopped it short. Cost is beside the title already.
 */
export function summaryOf(
	grid: EvalGrid,
	stopped: boolean,
	faulted: boolean,
): string {
	const byScenario = new Map<string, boolean>();
	for (const cell of grid.grid) {
		if (cell.run !== null) {
			byScenario.set(
				cell.scenario,
				(byScenario.get(cell.scenario) ?? true) && cell.run.status === "pass",
			);
		}
	}
	if (byScenario.size === 0) {
		return "No run landed.";
	}
	const landed = grid.cells - (grid.tally.pending ?? 0);
	const passed = grid.tally.pass ?? 0;
	const passing = [...byScenario.values()].filter(Boolean).length;
	const others = (["error", "unreadable"] as const)
		.filter((each) => grid.tally[each])
		.map(
			(each) =>
				`${grid.tally[each]} ${each === "error" ? (grid.tally[each] === 1 ? "error" : "errors") : "unreadable"}`,
		);
	const parts = [
		...(stopped ? [`Stopped after ${landed} of ${grid.cells} runs`] : []),
		byScenario.size === landed
			? `${passed} of ${landed} passed`
			: `${passing} of ${byScenario.size} ${byScenario.size === 1 ? "scenario passes" : "scenarios pass"} every run, ${passed} of ${landed} runs`,
		...others,
	];
	return `${parts.join(" · ")}${faulted ? ". Failures by fault:" : "."}`;
}

/** The faults the remarks name, or null when they name none or are not valid. */
function faultsIn(grid: EvalGrid): Faults | null {
	try {
		return grid.remarks === undefined ? null : faultsOf(grid.remarks);
	} catch {
		return null;
	}
}

const LAYER_NAME: Record<FaultLayer, string> = {
	harness: "Harness",
	judge: "Judge",
	skill: "Skill",
	eval: "Eval",
};

/** A tile per layer with the failed runs it is blamed for, all alike. */
export function FaultTiles({ faults }: { faults: Faults }): JSX.Element {
	return (
		<ul aria-label="faults" className="grid grid-cols-4 gap-2">
			{FAULT_LAYERS.map((layer) => (
				<li
					key={layer}
					aria-label={`${LAYER_NAME[layer]}: ${faults.counts[layer]}`}
					className="flex flex-col items-center rounded-lg border px-2 py-2"
				>
					<span className="font-semibold text-lg tabular-nums leading-snug">
						{faults.counts[layer]}
					</span>
					<span className="text-muted-foreground text-sm">
						{LAYER_NAME[layer]}
					</span>
				</li>
			))}
		</ul>
	);
}

/**
 * What an ended run comes to: one line, then the failures per layer at fault.
 * The report adds the remarks' prose; the run card leaves it to the report.
 */
export function EvalSummary({
	grid,
	stopped,
	prose = false,
}: {
	grid: EvalGrid;
	stopped: boolean;
	/** Shows the remarks beyond their Faults list, as the report does. */
	prose?: boolean;
}): JSX.Element {
	const faults = faultsIn(grid);
	const failed = (grid.tally.fail ?? 0) > 0;
	const shown = faults !== null && failed;
	const rest =
		grid.remarks === undefined ? "" : (faults?.prose ?? grid.remarks);
	return (
		<section
			aria-label="summary"
			className="flex flex-col gap-2 border-border/60 border-t pt-2"
		>
			<p className="text-muted-foreground text-sm">
				{summaryOf(grid, stopped, shown)}
			</p>
			{shown && <FaultTiles faults={faults} />}
			{prose && rest !== "" && (
				<section aria-label="remarks" className="text-sm">
					<Markdown text={remarkList(rest)} />
				</section>
			)}
		</section>
	);
}
