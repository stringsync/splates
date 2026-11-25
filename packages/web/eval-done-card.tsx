import type { EvalGrid } from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { evalBatch } from "./api";
import { CardBody } from "./card-shell";
import { ChecksSection } from "./checks-section";
import type { EvalDoneReport } from "./eval-done-report";
import { EvalSpecResults } from "./eval-spec-results";

/**
 * The body of a Done report that ends an eval loop: its line on the outcome,
 * then the results of its last run as spec rows.
 */
export function EvalDoneBody({
	read,
	lead,
}: {
	read: EvalDoneReport;
	lead: boolean;
}): JSX.Element {
	const [grid, setGrid] = useState<EvalGrid | null>(null);
	useEffect(() => {
		let current = true;
		evalBatch(read.batch).then(
			(found) => current && setGrid(found),
			() => undefined,
		);
		return () => {
			current = false;
		};
	}, [read.batch]);
	return (
		<>
			{read.outcome !== "" && <CardBody text={read.outcome} lead={lead} />}
			{read.checks !== "" || grid === null ? (
				read.checks !== "" && (
					<div className="mx-4 mb-3 text-sm">
						<ChecksSection text={read.checks} />
					</div>
				)
			) : (
				<EvalSpecResults grid={grid} />
			)}
		</>
	);
}
