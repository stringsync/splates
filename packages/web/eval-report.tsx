import type {
	EvalCell,
	EvalGrid,
	EvalTarget,
} from "@stringsync/splates-server/evals/browser";
import { type JSX, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { ORDER, StatusChip, spent } from "./eval-status";

/**
 * A batch of evals as one card: its totals, then a grid of its probes,
 * grouped by aspect, against the agents it ran on, each cell a run's outcome
 * or pending until it lands. Narrowed to one aspect, it shows only that part
 * of the skill. A landed cell opens its run.
 */
export function EvalReport({
	grid,
	onOpen,
}: {
	grid: EvalGrid;
	/** Opens the run a cell landed, by its id. */
	onOpen: (run: string) => void;
}): JSX.Element {
	const [aspect, setAspect] = useState<string | null>(null);
	const aspects = useMemo(
		() => [...new Set(grid.grid.map((cell) => cell.aspect))],
		[grid.grid],
	);
	const rows = useMemo(() => rowsOf(grid.grid, aspect), [grid.grid, aspect]);
	return (
		<section
			aria-label="eval report"
			className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
		>
			<header className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<h2 className="font-medium">
					{grid.skill ?? "Evals"} · {new Date(grid.startedAt).toLocaleString()}
				</h2>
				<span className="text-muted-foreground text-xs">
					{grid.cells} {grid.cells === 1 ? "cell" : "cells"} · {spent(grid)}
				</span>
				<span className="flex flex-wrap gap-2">
					{ORDER.filter((status) => grid.tally[status]).map((status) => (
						<span key={status} className="flex items-center gap-1">
							<StatusChip status={status} />
							<span className="text-xs tabular-nums">{grid.tally[status]}</span>
						</span>
					))}
				</span>
			</header>
			{aspects.length > 1 && (
				<div
					role="radiogroup"
					aria-label="Aspect"
					className="flex flex-wrap gap-1"
				>
					{[null, ...aspects].map((each) => (
						<Button
							key={each ?? "all"}
							type="button"
							role="radio"
							aria-checked={each === aspect}
							size="sm"
							variant={each === aspect ? "secondary" : "ghost"}
							onClick={() => setAspect(each)}
						>
							{each ?? "All"}
						</Button>
					))}
				</div>
			)}
			<div className="overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr>
							<th className="py-1 pr-3 text-left font-normal text-muted-foreground text-xs">
								Probe
							</th>
							{grid.targets.map((target) => (
								<th
									key={target.key}
									className="px-2 py-1 text-left font-normal text-muted-foreground text-xs whitespace-nowrap"
								>
									{targetLabel(target)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) =>
							row.type === "aspect" ? (
								<tr key={`aspect:${row.aspect}`}>
									<th
										colSpan={grid.targets.length + 1}
										className="pt-3 pb-1 text-left font-medium text-muted-foreground text-xs uppercase"
									>
										{row.aspect}
									</th>
								</tr>
							) : (
								<tr key={row.probe} className="border-t">
									<td className="py-1.5 pr-3 align-top">
										<div className="font-medium">{row.probe}</div>
										<div className="text-muted-foreground text-xs">
											{row.requirement}
										</div>
									</td>
									{grid.targets.map((target) => (
										<td key={target.key} className="px-2 py-1.5 align-top">
											<Cells
												cells={row.cells.filter(
													(cell) => cell.target === target.key,
												)}
												onOpen={onOpen}
											/>
										</td>
									))}
								</tr>
							),
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}

/** One probe on one agent: a chip for each repetition, each opening its run. */
function Cells({
	cells,
	onOpen,
}: {
	cells: EvalCell[];
	onOpen: (run: string) => void;
}): JSX.Element {
	if (cells.length === 0) {
		return <span className="text-muted-foreground text-xs">not run</span>;
	}
	return (
		<span className="flex flex-wrap gap-1">
			{cells.map((cell) =>
				cell.run === null ? (
					<StatusChip key={cell.repetition} status="pending" />
				) : (
					<button
						key={cell.repetition}
						type="button"
						title={spent(cell.run)}
						aria-label={`${cell.probe} on ${cell.target}, repetition ${cell.repetition + 1}: ${cell.run.status}`}
						onClick={() => onOpen(cell.run?.id ?? "")}
						className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					>
						<StatusChip
							status={cell.run.status}
							className={cn("cursor-pointer hover:opacity-80")}
						/>
					</button>
				),
			)}
		</span>
	);
}

type Row =
	| { type: "aspect"; aspect: string }
	| { type: "probe"; probe: string; requirement: string; cells: EvalCell[] };

/** The grid's rows: each aspect's heading, then its probes, in the order the batch planned them. */
function rowsOf(cells: EvalCell[], aspect: string | null): Row[] {
	const byAspect = new Map<string, Map<string, EvalCell[]>>();
	for (const cell of cells) {
		if (aspect !== null && cell.aspect !== aspect) {
			continue;
		}
		const probes = byAspect.get(cell.aspect) ?? new Map<string, EvalCell[]>();
		probes.set(cell.probe, [...(probes.get(cell.probe) ?? []), cell]);
		byAspect.set(cell.aspect, probes);
	}
	return [...byAspect].flatMap(([name, probes]): Row[] => [
		{ type: "aspect", aspect: name },
		...[...probes].map(
			([probe, each]): Row => ({
				type: "probe",
				probe,
				requirement: each[0]?.requirement ?? "",
				cells: each,
			}),
		),
	]);
}

export function targetLabel(target: EvalTarget): string {
	return target.model === null
		? target.agent
		: `${target.agent} ${target.model}`;
}
