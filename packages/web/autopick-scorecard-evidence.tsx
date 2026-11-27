import {
	HOLDOUT_MIN_TASKS,
	type ScorecardRow,
} from "@splates/server/stats/browser";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { percent } from "./stats-advice";
import { NONE } from "./stats-columns";

export function ScorecardEvidence({
	row,
	lineupName,
}: {
	row: ScorecardRow;
	/** A lineup's name by its id, for the holdout's easier lineup. */
	lineupName: (id: string | null) => string;
}): JSX.Element {
	const metrics = [
		["Cost / task", figure(row.dollarsPerTask, dollars)],
		["Avg. turns", figure(row.turns, (value) => value.toFixed(1))],
		["Avg. diff", figure(row.lines, (value) => `${Math.round(value)} lines`)],
		["Trouble", figure(row.troubleRate, percent)],
		["Corrections", figure(row.correctionRate, percent)],
		["Lifted", percent(row.liftRate)],
		["Overrides", `${row.overridesUp} up · ${row.overridesDown} down`],
	];
	return (
		<>
			<div className="flex flex-col gap-1 text-muted-foreground text-xs">
				{row.verdict === "sparse" && <p>Too few tasks to judge.</p>}
				{row.signals.includes("lifts") && (
					<p>
						Autopick moved {row.lifts} of {row.tasks} tasks to a stronger pick
						after they started.
					</p>
				)}
				{row.signals.includes("trouble") && (
					<p>
						{row.troubledWithoutLift} of {row.tasks} tasks hit trouble without a
						lift.
					</p>
				)}
				{row.signals.includes("overrides") && (
					<p>
						The pick was manually moved up on {row.overridesUp} of {row.tasks}{" "}
						tasks.
					</p>
				)}
				{row.signals.includes("cost") && row.comparison !== null && (
					<p>
						The most common pick had clean outcomes and cost{" "}
						{row.comparison.ratio.toFixed(1)}× as much as the next observed pick
						down in this cell ({dollars(row.comparison.cost)} vs{" "}
						{dollars(row.comparison.nextCost)} per task).
					</p>
				)}
			</div>
			<dl className="grid grid-cols-3 gap-2 text-sm md:grid-cols-7">
				{metrics.map(([label, value]) => (
					<div key={label}>
						<dt className="text-muted-foreground text-xs">{label}</dt>
						<dd className="font-medium tabular-nums">{value}</dd>
					</div>
				))}
			</dl>
			{row.holdout !== null && (
				<HoldoutEvidence
					holdout={row.holdout}
					easier={lineupName(row.holdout.easier)}
				/>
			)}
			{row.overridesUnranked > 0 && (
				<p className="text-muted-foreground text-xs">
					{row.overridesUnranked}{" "}
					{row.overridesUnranked === 1
						? "task has an override"
						: "tasks have overrides"}{" "}
					with unknown direction.
				</p>
			)}
		</>
	);
}

/** The cell's held-out tasks beside its regular ones, each with how many it has. */
function HoldoutEvidence({
	holdout,
	easier,
}: {
	holdout: NonNullable<ScorecardRow["holdout"]>;
	easier: string;
}): JSX.Element {
	const { heldOut, regular } = holdout;
	const rows = [
		[
			"Problems",
			figure(heldOut.problemRate, percent),
			figure(regular.problemRate, percent),
		],
		[
			"Cost / task",
			figure(heldOut.dollarsPerTask, dollars),
			figure(regular.dollarsPerTask, dollars),
		],
	];
	const enough =
		heldOut.tasks >= HOLDOUT_MIN_TASKS && regular.tasks >= HOLDOUT_MIN_TASKS;
	return (
		<div className="flex flex-col gap-1.5 text-xs">
			<p className="text-muted-foreground">
				Holdout: tasks started one difficulty easier, on {easier}. A problem is
				trouble, a lift or an override up.
			</p>
			<table className="w-fit tabular-nums">
				<thead className="text-muted-foreground">
					<tr>
						<th className="pr-4 text-left font-normal" />
						<th className="pr-4 text-left font-normal">
							Held out · {count(heldOut.tasks)}
						</th>
						<th className="text-left font-normal">
							Regular · {count(regular.tasks)}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(([label, held, usual]) => (
						<tr key={label}>
							<td className="pr-4 text-muted-foreground">{label}</td>
							<td
								className={cn(
									"pr-4 font-medium",
									holdout.overpowered && "text-success",
								)}
							>
								{held}
							</td>
							<td className="font-medium">{usual}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="text-muted-foreground">
				{holdout.overpowered
					? "The held-out tasks did as well: the cell may not need this lineup."
					: enough
						? "The held-out tasks did worse, so this lineup holds up."
						: `Called at ${HOLDOUT_MIN_TASKS} tasks on each side.`}
			</p>
		</div>
	);
}

function count(tasks: number): string {
	return `${tasks} ${tasks === 1 ? "task" : "tasks"}`;
}

function dollars(value: number): string {
	return `$${value.toFixed(2)}`;
}

function figure(
	value: number | null,
	shown: (value: number) => string,
): string {
	return value === null ? NONE : shown(value);
}
