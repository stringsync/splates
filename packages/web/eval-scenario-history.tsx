import type {
	EvalBatch,
	EvalGrid,
	EvalScenario,
} from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { evalBatch, evalBatches } from "./api";
import { ReadingNow } from "./countdown";

/** The batches that ran a scenario, newest first, each opening its report. */
export function ScenarioHistory({
	scenario,
	onOpenBatch,
}: {
	scenario: EvalScenario;
	onOpenBatch: (batch: string) => void;
}): JSX.Element {
	const [grids, setGrids] = useState<EvalGrid[] | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		evalBatches()
			.then((batches: EvalBatch[] | null) =>
				Promise.all((batches ?? []).map((each) => evalBatch(each.id))),
			)
			.then(
				(each) => current && setGrids(each),
				(error: unknown) =>
					current &&
					setFailed(error instanceof Error ? error.message : String(error)),
			);
		return () => {
			current = false;
		};
	}, []);
	if (failed !== null) {
		return (
			<p role="alert" className="text-destructive text-xs">
				{failed}
			</p>
		);
	}
	if (grids === null) {
		return <ReadingNow label="Reading history…" />;
	}
	const ran = grids
		.map((grid) => ({
			grid,
			cells: grid.grid.filter((cell) => cell.scenario === scenario.id),
		}))
		.filter((each) => each.cells.length > 0)
		.sort((left, right) =>
			right.grid.startedAt.localeCompare(left.grid.startedAt),
		);
	return (
		<div className="flex flex-col gap-2">
			{scenario.about !== null && <p className="text-sm">{scenario.about}</p>}
			{ran.length === 0 ? (
				<p className="text-muted-foreground text-xs">No batch ran this yet.</p>
			) : (
				<ul className="flex flex-col gap-1">
					{ran.map(({ grid, cells }, at) => (
						<li key={grid.id}>
							<button
								type="button"
								className="text-info text-xs underline"
								onClick={() => onOpenBatch(grid.id)}
							>
								{at === 0 ? "Latest report" : "Report"} ·{" "}
								{new Date(grid.startedAt).toLocaleString()}
							</button>
							<span className="ml-2 text-muted-foreground text-xs tabular-nums">
								{cells.filter((cell) => cell.run?.status === "pass").length}/
								{cells.length} pass
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
