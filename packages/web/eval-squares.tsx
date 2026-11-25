import type {
	EvalCell,
	EvalGrid,
	EvalStatus,
	EvalTarget,
} from "@splates/server/evals/browser";
import type { EvalLeftOut } from "@splates/server/plans";
import { type JSX, type ReactNode, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import { targetDisplay } from "./eval-spec-data";

/** How a run shows as a square: its outcome, or `running`, or `skipped` when a stop left it unstarted. */
export type SquareState = EvalStatus | "running" | "skipped";

const LOOKS: Record<SquareState, string> = {
	pass: "bg-emerald-500",
	fail: "bg-destructive",
	error: "bg-amber-500",
	unreadable: "bg-destructive",
	pending: "bg-muted-foreground/20",
	running:
		"animate-pulse bg-indigo-50 outline-[1.5px] outline-indigo-300 -outline-offset-[1.5px] dark:bg-indigo-950 motion-reduce:animate-none",
	skipped: "border border-dashed border-muted-foreground/50",
};

/** Scenario rows shown before the rest fold behind Show more. */
export const FOLDED_ROWS = 6;

/** One scenario's runs, in agent order and then by repetition. */
export interface ScenarioLine {
	scenario: string;
	/** What it checks, for the report; empty when unknown. */
	requirement: string;
	/** The test as one sentence, its subject then its `it`; empty when it is not written as a spec. */
	test: string;
	cells: EvalCell[];
}

/** Where every run of a card or report stands: the cells, and which are running or never started. */
export interface SquaresState {
	running: Set<EvalCell>;
	stopped: boolean;
}

/** A run's state as its square shows it. */
export function squareOf(cell: EvalCell, state: SquaresState): SquareState {
	const status = cell.run?.status ?? "pending";
	if (status !== "pending") {
		return status;
	}
	return state.running.has(cell)
		? "running"
		: state.stopped
			? "skipped"
			: "pending";
}

/** The cells a run will have before it starts: each scenario on each agent at each repetition. */
export function plannedCells(
	scenarios: readonly string[],
	targets: readonly string[],
	reps: number,
): EvalCell[] {
	return scenarios.flatMap((scenario) =>
		targets.flatMap((target) =>
			Array.from({ length: reps }, (_, repetition) => ({
				scenario,
				aspect: "",
				requirement: "",
				target,
				repetition,
				run: null,
			})),
		),
	);
}

/** The grid's scenarios in the order it planned them, each with its runs by agent then repetition. */
export function linesOf(
	cells: readonly EvalCell[],
	targets: readonly string[],
): ScenarioLine[] {
	const order = new Map(targets.map((key, at) => [key, at]));
	const lines = new Map<string, ScenarioLine>();
	for (const cell of cells) {
		const line = lines.get(cell.scenario) ?? {
			scenario: cell.scenario,
			requirement: cell.requirement,
			test:
				cell.sentence === undefined
					? ""
					: [cell.subject, cell.sentence].filter(Boolean).join(" "),
			cells: [],
		};
		line.cells.push(cell);
		lines.set(cell.scenario, line);
	}
	for (const line of lines.values()) {
		line.cells.sort(
			(one, other) =>
				(order.get(one.target) ?? 0) - (order.get(other.target) ?? 0) ||
				one.repetition - other.repetition,
		);
	}
	return [...lines.values()];
}

/** The cells running now: the first unlanded one of each agent while the run goes. */
export function runningCells(
	grid: Pick<EvalGrid, "grid" | "targets">,
	running: boolean,
): Set<EvalCell> {
	const now = new Set<EvalCell>();
	if (!running) {
		return now;
	}
	for (const target of grid.targets) {
		const next = grid.grid.find(
			(cell) => cell.target === target.key && cell.run === null,
		);
		if (next !== undefined) {
			now.add(next);
		}
	}
	return now;
}

/** The part of each scenario id shared by all, as `group/`, dropped where rows have little room. */
export function sharedPrefix(scenarios: readonly string[]): string {
	const first = scenarios[0];
	const cut = first?.lastIndexOf("/") ?? -1;
	if (first === undefined || cut < 0) {
		return "";
	}
	const prefix = first.slice(0, cut + 1);
	return scenarios.every((each) => each.startsWith(prefix)) ? prefix : "";
}

/** One run as a small square; a landed one opens its run when `onOpen` is given. */
export function Square({
	cell,
	state,
	onOpen,
}: {
	cell: EvalCell;
	state: SquareState;
	onOpen?: (run: string) => void;
}): JSX.Element {
	const label = `${cell.scenario} on ${cell.target}, repetition ${cell.repetition + 1}: ${state}`;
	const look = cn("size-3.5 shrink-0 rounded-[3px]", LOOKS[state]);
	const run = cell.run;
	if (onOpen !== undefined && run !== null) {
		return (
			<button
				type="button"
				aria-label={label}
				title={label}
				onClick={() => onOpen(run.id)}
				className={cn(
					look,
					"cursor-pointer hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
				)}
			/>
		);
	}
	return <span role="img" aria-label={label} title={label} className={look} />;
}

/** The hollow green square of an agent left out of the round after it passed. */
const LEFT_OUT =
	"size-3.5 shrink-0 rounded-[3px] border-[1.5px] border-emerald-500";

/** What a left-out square says: the round its agent passed in. */
export function leftOutText(round: number): string {
	return `passed in round ${round}, left out`;
}

/** One agent left out of the round, as a hollow green square after the run's own. */
function LeftOutSquare({
	scenario,
	out,
}: {
	scenario: string;
	out: EvalLeftOut;
}): JSX.Element {
	const label = `${scenario} on ${out.agent}: ${leftOutText(out.round)}`;
	return (
		<span role="img" aria-label={label} title={label} className={LEFT_OUT} />
	);
}

/** A row of squares, left-aligned, wrapping onto more lines when long. */
export function Squares({
	cells,
	state,
	onOpen,
	scenario = "",
	leftOut = [],
}: {
	cells: readonly EvalCell[];
	state: SquaresState;
	onOpen?: (run: string) => void;
	/** The row's scenario, naming its left-out squares. */
	scenario?: string;
	/** Agents the asking agent left out after they passed, shown hollow at the end. */
	leftOut?: readonly EvalLeftOut[];
}): JSX.Element {
	return (
		<span className="flex min-w-0 flex-1 flex-wrap content-start gap-[3px]">
			{cells.map((cell) => (
				<Square
					key={`${cell.target}:${cell.repetition}`}
					cell={cell}
					state={squareOf(cell, state)}
					onOpen={onOpen}
				/>
			))}
			{leftOut.map((out) => (
				<LeftOutSquare
					key={`left-out:${out.agent}`}
					scenario={scenario}
					out={out}
				/>
			))}
		</span>
	);
}

/** Under the rows: one hollow square per round its left-out agents passed in, saying so. */
export function LeftOutLegend({
	leftOut,
}: {
	leftOut: readonly EvalLeftOut[];
}): JSX.Element | null {
	const rounds = [...new Set(leftOut.map((out) => out.round))].sort(
		(one, other) => one - other,
	);
	if (rounds.length === 0) {
		return null;
	}
	return (
		<ul
			aria-label="left out"
			className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5 text-muted-foreground text-xs"
		>
			{rounds.map((round) => (
				<li key={round} className="flex items-center gap-1.5">
					<span aria-hidden className={LEFT_OUT} />
					{leftOutText(round)}
					{": "}
					{leftOut
						.filter((out) => out.round === round)
						.map((out) => out.agent)
						.join(", ")}
				</li>
			))}
		</ul>
	);
}

/** `passed/landed` for a row, or nothing before any landed. */
export function passCount(cells: readonly EvalCell[]): string {
	const landed = cells.filter((cell) => cell.run !== null);
	return landed.length === 0
		? ""
		: `${landed.filter((cell) => cell.run?.status === "pass").length}/${landed.length}`;
}

/**
 * Each scenario as a row: its name in a fixed column, one square per run,
 * and how many of its landed runs passed. Rows past `FOLDED_ROWS` fold behind
 * Show more; `detail` adds what the report shows under each row.
 */
export function ScenarioSquares({
	lines,
	state,
	onOpen,
	detail,
	big = false,
	leftOut = [],
}: {
	lines: readonly ScenarioLine[];
	state: SquaresState;
	onOpen?: (run: string) => void;
	detail?: (line: ScenarioLine) => ReactNode;
	/** Agents the asking agent left out of this round after they passed. */
	leftOut?: readonly EvalLeftOut[];
	/** The report's size: a wider name column, in bolder type. */
	big?: boolean;
}): JSX.Element {
	const [shown, setShown] = useState(FOLDED_ROWS);
	const prefix = big ? "" : sharedPrefix(lines.map((line) => line.scenario));
	const rest = lines.length - shown;
	return (
		<div className="flex flex-col">
			<ul aria-label="scenarios" className="flex flex-col">
				{lines.slice(0, shown).map((line) => (
					<li
						key={line.scenario}
						aria-label={line.scenario}
						className={cn(
							"flex flex-col border-border/60 border-t first:border-t-0",
							big ? "gap-2 py-3" : "py-1.5",
						)}
					>
						<div className="flex items-start gap-3 text-sm">
							<span
								title={line.scenario}
								className={cn(
									"shrink-0 break-words font-mono",
									big ? "w-56 max-w-[45%] font-semibold" : "w-[150px]",
								)}
							>
								{line.scenario.slice(prefix.length)}
							</span>
							<Squares
								cells={line.cells}
								state={state}
								onOpen={onOpen}
								scenario={line.scenario}
								leftOut={leftOut}
							/>
							<span className="shrink-0 text-muted-foreground tabular-nums">
								{passCount(line.cells)}
							</span>
						</div>
						{detail?.(line)}
					</li>
				))}
			</ul>
			<LeftOutLegend leftOut={leftOut} />
			{rest > 0 && (
				<p className="flex gap-1 pt-1 text-sm">
					<button
						type="button"
						className="text-info hover:underline"
						onClick={() => setShown(shown + FOLDED_ROWS)}
					>
						Show {Math.min(rest, FOLDED_ROWS)} more
					</button>
					{rest > FOLDED_ROWS && (
						<>
							<span className="text-muted-foreground">·</span>
							<button
								type="button"
								className="text-info hover:underline"
								onClick={() => setShown(lines.length)}
							>
								Show all {lines.length} scenarios
							</button>
						</>
					)}
				</p>
			)}
		</div>
	);
}

/** Under a report row: each agent's runs of the scenario, on its own line. */
export function AgentLines({
	line,
	targets,
	state,
	onOpen,
}: {
	line: ScenarioLine;
	targets: readonly EvalTarget[];
	state: SquaresState;
	onOpen?: (run: string) => void;
}): JSX.Element {
	return (
		<ul
			aria-label={`${line.scenario} by agent`}
			className="flex flex-col gap-1"
		>
			{targets.map((target) => {
				const cells = line.cells.filter((cell) => cell.target === target.key);
				const { markAgent, label } = targetDisplay(target);
				const quiet = [
					target.effort,
					target.skill === null ? null : `baseline ${target.skill.slice(0, 7)}`,
				]
					.filter((part) => part !== null && part !== "")
					.join(" · ");
				return (
					<li key={target.key} className="flex items-center gap-3 text-sm">
						<span className="flex w-56 max-w-[45%] shrink-0 items-center gap-1.5 break-words text-muted-foreground">
							<AgentMark agent={markAgent} className="size-[15px] shrink-0" />
							<span>
								{label}
								{quiet !== "" && (
									<span className="text-muted-foreground/70"> · {quiet}</span>
								)}
							</span>
						</span>
						<Squares cells={cells} state={state} onOpen={onOpen} />
					</li>
				);
			})}
		</ul>
	);
}

/** Remarks as a bulleted list: the agent's own list as written, else a paragraph split at its sentences. */
export function remarkList(text: string): string {
	if (/^\s*(?:[-*]|\d+\.)\s/mu.test(text)) {
		return text;
	}
	// A sentence ends at `.`, `!` or `?` before a space and a capital, so
	// `export.ts` or `e.g. this` stays whole.
	return text
		.replace(/\s+/gu, " ")
		.trim()
		.split(/(?<=[.!?])\s+(?=[A-Z0-9"'`*([])/u)
		.filter((sentence) => sentence !== "")
		.map((sentence) => `- ${sentence}`)
		.join("\n");
}
