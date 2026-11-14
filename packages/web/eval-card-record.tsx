import type {
	EvalCell,
	EvalGrid,
	EvalStatus,
} from "@splates/server/evals/browser";
import { targetName } from "@splates/server/evals/browser";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { elapsedMs, formatElapsed, useSecondClock } from "./eval-elapsed";
import { ORDER, StatusChip } from "./eval-status";
import { Markdown } from "./markdown";

/** Scenario rows a table shows before the rest fold behind a button. */
const FOLDED_ROWS = 6;

/** What a run card keeps once started: every run as a pill, then its cost and remarks, with the report one click away. */
export function EvalRunRecord({
	grid,
	running,
	stopped,
	budget,
}: {
	grid: EvalGrid;
	running: boolean;
	stopped: boolean;
	/** This round's dollar budget, when the card is in a conversation. */
	budget: number | null;
}): JSX.Element {
	const [all, setAll] = useState(false);
	const clock = useSecondClock(running);
	const now = runningCells(grid, running);
	const open = (run: string): void => {
		location.hash = `#evals/${encodeURIComponent(grid.id)}/${encodeURIComponent(run)}`;
	};
	const scenarios = [...new Set(grid.grid.map((cell) => cell.scenario))];
	const shown = all ? scenarios : scenarios.slice(0, FOLDED_ROWS);
	const pills = (cells: EvalCell[]): JSX.Element => (
		<span className="flex flex-wrap gap-0.5">
			{cells.map((cell) => (
				<Pill
					key={`${cell.scenario}:${cell.target}:${cell.repetition}`}
					cell={cell}
					stopped={stopped}
					running={now.has(cell)}
					onOpen={open}
				/>
			))}
		</span>
	);
	const landed = grid.cells - (grid.tally.pending ?? 0);
	const outcomes = ORDER.filter(
		(each) => each !== "pending" && grid.tally[each],
	);
	const cost = `$${(grid.costUsd ?? 0).toFixed(2)}`;
	const stats: [string, string][] = [
		["Elapsed", formatElapsed(elapsedMs(grid, running, clock))],
		[
			"Cost",
			budget === null ? cost : `${cost} of $${budget.toFixed(2)} budget`,
		],
	];
	if (running) {
		stats.unshift(["Landed", `${landed} of ${grid.cells}`]);
	}
	return (
		<div className="flex flex-col gap-2">
			{scenarios.length <= 1 ? (
				<ul aria-label="eval runs" className="flex flex-col gap-1.5 text-xs">
					{grid.targets.map((target) => {
						const cells = grid.grid.filter(
							(cell) => cell.target === target.key,
						);
						const done = cells.filter((cell) => cell.run !== null).length;
						return (
							<li
								key={target.key}
								className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
							>
								<span className="min-w-0 flex-1 break-words text-muted-foreground">
									{targetName(target)}
								</span>
								{pills(cells)}
								<span className="w-16 text-right tabular-nums">
									{done} of {cells.length}
								</span>
							</li>
						);
					})}
				</ul>
			) : (
				<>
					<ul aria-label="eval runs" className="flex flex-col gap-1.5 text-xs">
						{shown.map((scenario) => (
							<li
								key={scenario}
								className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
							>
								<span className="min-w-0 flex-1 break-words">{scenario}</span>
								{pills(grid.grid.filter((cell) => cell.scenario === scenario))}
							</li>
						))}
					</ul>
					{scenarios.length > FOLDED_ROWS && (
						<Button
							size="xs"
							variant="ghost"
							className="self-start"
							onClick={() => setAll(!all)}
						>
							{all ? "Show fewer" : `Show all ${scenarios.length} scenarios`}
						</Button>
					)}
				</>
			)}
			<div className="flex flex-col gap-2" data-testid="record-cost">
				{outcomes.length > 0 && (
					<ul aria-label="outcomes" className="flex flex-wrap gap-x-3 gap-y-1">
						{outcomes.map((each) => (
							<li key={each} className="flex items-center gap-1">
								<StatusChip status={each} />
								<span className="text-xs tabular-nums">{grid.tally[each]}</span>
							</li>
						))}
					</ul>
				)}
				<dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
					{stats.map(([label, value]) => (
						<div key={label} className="flex flex-col">
							<dt className="text-muted-foreground">{label}</dt>
							<dd className="font-medium tabular-nums">{value}</dd>
						</div>
					))}
				</dl>
			</div>
			{grid.remarks !== undefined && !running && (
				<RemarkList text={grid.remarks} />
			)}
			<a
				href={`#evals/${encodeURIComponent(grid.id)}`}
				className="text-info text-xs underline"
			>
				Open the report
			</a>
		</div>
	);
}

const PILLS: Record<Exclude<EvalStatus, "pending">, string> = {
	pass: "bg-emerald-500",
	fail: "bg-destructive",
	error: "bg-amber-500",
	unreadable: "bg-destructive",
};

/** One run as a pill: gray while pending, pulsing while it is the one running, hollow when the run stopped before it, else its outcome. */
function Pill({
	cell,
	stopped,
	running,
	onOpen,
}: {
	cell: EvalCell;
	stopped: boolean;
	running: boolean;
	onOpen: (run: string) => void;
}): JSX.Element {
	const status = cell.run?.status ?? "pending";
	const label = `${cell.scenario} on ${cell.target}, repetition ${cell.repetition + 1}: ${status}`;
	const base = "size-2.5 rounded-[2px]";
	if (status === "pending") {
		return (
			<span
				role="img"
				aria-label={label}
				title={`${cell.scenario}: ${running ? "running" : status}`}
				className={cn(
					base,
					stopped
						? "border border-muted-foreground/50"
						: "bg-muted-foreground/30",
					running && "animate-pulse bg-muted-foreground/60",
				)}
			/>
		);
	}
	return (
		<button
			type="button"
			aria-label={label}
			title={`${cell.scenario}: ${status}`}
			onClick={() => onOpen(cell.run?.id ?? "")}
			className={cn(
				base,
				PILLS[status],
				"focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
			)}
		/>
	);
}

/** The cells running now: the first pending one of each agent while the run goes. */
function runningCells(grid: EvalGrid, running: boolean): Set<EvalCell> {
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

/** Remarks as a bulleted list: the agent's own list as written, one paragraph of sentences split into items. */
function RemarkList({ text }: { text: string }): JSX.Element {
	const written = /^\s*(?:[-*]|\d+\.)\s/mu.test(text);
	const sentences =
		text
			.replace(/\s+/gu, " ")
			.trim()
			.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/gu) ?? [];
	const list = written
		? text
		: sentences.map((sentence) => `- ${sentence.trim()}`).join("\n");
	return (
		<section aria-label="remarks" className="text-xs">
			<h3 className="mb-1 font-medium text-muted-foreground">Remarks</h3>
			<Markdown text={list} />
		</section>
	);
}
