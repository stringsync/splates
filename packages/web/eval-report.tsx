import type {
	EvalCell,
	EvalGrid,
} from "@stringsync/splates-server/evals/browser";
import { targetName } from "@stringsync/splates-server/evals/browser";
import { type JSX, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { ImproveMenu, improvable, ownBatch } from "./eval-improve";
import { ORDER, StatusChip, spent } from "./eval-status";

/** Shows an eval batch's totals and results; select a landed cell to open its run. */
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
			<div className="hidden md:block">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr>
							<th className="py-1 pr-3 text-left font-normal text-muted-foreground text-xs">
								Scenario
							</th>
							{grid.targets.map((target) => (
								<th
									key={target.key}
									className="px-2 py-1 text-left font-normal text-muted-foreground text-xs whitespace-nowrap"
								>
									{targetName(target)}
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
								<tr key={row.scenario} className="border-t">
									<td className="py-1.5 pr-3 align-top">
										<div className="font-medium">{row.scenario}</div>
										<div className="text-muted-foreground text-xs">
											{row.requirement}
										</div>
										{ownBatch(grid.producer) && worst(row.cells) !== null && (
											<ImproveMenu
												run={worst(row.cells) ?? ""}
												className="mt-1"
											/>
										)}
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
			<div className="md:hidden">
				{rows.map((row) =>
					row.type === "aspect" ? (
						<div
							key={`aspect:${row.aspect}`}
							className="pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase"
						>
							{row.aspect}
						</div>
					) : (
						<div key={row.scenario} className="border-t py-2">
							<div className="font-medium">{row.scenario}</div>
							<div className="text-muted-foreground text-xs">
								{row.requirement}
							</div>
							{grid.targets.map((target) => (
								<div
									key={target.key}
									className="flex items-center justify-between gap-2 py-0.5"
								>
									<span className="text-muted-foreground text-xs">
										{targetName(target)}
									</span>
									<Cells
										cells={row.cells.filter(
											(cell) => cell.target === target.key,
										)}
										onOpen={onOpen}
									/>
								</div>
							))}
							{ownBatch(grid.producer) && worst(row.cells) !== null && (
								<ImproveMenu run={worst(row.cells) ?? ""} className="mt-1" />
							)}
						</div>
					),
				)}
			</div>
		</section>
	);
}

/**
 * A batch condensed for the card that started it: each scenario's outcome on
 * each agent, a chip per repetition opening its run on the Evals page.
 */
export function EvalSummary({ grid }: { grid: EvalGrid }): JSX.Element {
	const scenarios = useMemo(
		() => [...new Set(grid.grid.map((cell) => cell.scenario))],
		[grid.grid],
	);
	const open = (run: string): void => {
		location.hash = `#evals/${encodeURIComponent(grid.id)}/${encodeURIComponent(run)}`;
	};
	return (
		<>
			<div className="hidden md:block">
				<table
					aria-label="eval summary"
					className="w-full border-collapse text-xs"
				>
					<thead>
						<tr>
							<th className="sr-only">Scenario</th>
							{grid.targets.map((target) => (
								<th
									key={target.key}
									className="px-1.5 pb-1 text-left align-top font-normal text-muted-foreground"
								>
									{targetName(target)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{scenarios.map((scenario) => (
							<tr key={scenario}>
								<td className="py-0.5 pr-2">
									<code>{scenario}</code>
								</td>
								{grid.targets.map((target) => (
									<td key={target.key} className="px-1.5 py-0.5">
										<Cells
											cells={grid.grid.filter(
												(cell) =>
													cell.scenario === scenario &&
													cell.target === target.key,
											)}
											onOpen={open}
										/>
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="text-xs md:hidden">
				{scenarios.map((scenario) => (
					<div key={scenario} className="py-1">
						<code>{scenario}</code>
						{grid.targets.map((target) => (
							<div
								key={target.key}
								className="flex items-center justify-between gap-2 py-0.5"
							>
								<span className="text-muted-foreground">
									{targetName(target)}
								</span>
								<Cells
									cells={grid.grid.filter(
										(cell) =>
											cell.scenario === scenario && cell.target === target.key,
									)}
									onOpen={open}
								/>
							</div>
						))}
					</div>
				))}
			</div>
		</>
	);
}

/** One scenario on one agent: a chip for each repetition, each opening its run. */
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
						aria-label={`${cell.scenario} on ${cell.target}, repetition ${cell.repetition + 1}: ${cell.run.status}`}
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

/** The id of the first landed run of `cells` worth improving, or null for none. */
function worst(cells: EvalCell[]): string | null {
	return (
		cells.find((cell) => cell.run !== null && improvable(cell.run.status))?.run
			?.id ?? null
	);
}

type Row =
	| { type: "aspect"; aspect: string }
	| {
			type: "scenario";
			scenario: string;
			requirement: string;
			cells: EvalCell[];
	  };

/** The grid's rows: each aspect's heading, then its scenarios, in the order the batch planned them. */
function rowsOf(cells: EvalCell[], aspect: string | null): Row[] {
	const byAspect = new Map<string, Map<string, EvalCell[]>>();
	for (const cell of cells) {
		if (aspect !== null && cell.aspect !== aspect) {
			continue;
		}
		const scenarios =
			byAspect.get(cell.aspect) ?? new Map<string, EvalCell[]>();
		scenarios.set(cell.scenario, [
			...(scenarios.get(cell.scenario) ?? []),
			cell,
		]);
		byAspect.set(cell.aspect, scenarios);
	}
	return [...byAspect].flatMap(([name, scenarios]): Row[] => [
		{ type: "aspect", aspect: name },
		...[...scenarios].map(
			([scenario, each]): Row => ({
				type: "scenario",
				scenario,
				requirement: each[0]?.requirement ?? "",
				cells: each,
			}),
		),
	]);
}
