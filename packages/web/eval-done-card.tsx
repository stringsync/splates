import type { EvalGrid } from "@splates/server/evals/browser";
import { type JSX, useContext, useEffect, useState } from "react";
import { evalBatch, evalBudget } from "./api";
import { CardBody } from "./card-shell";
import { EvalRunRecord } from "./eval-card-record";
import type { EvalDoneReport } from "./eval-done-report";
import { EvalsConversation } from "./evals-card";

/**
 * The body of a Done report that ends an eval loop: its line on the outcome,
 * then the results of its last run as the run card keeps them.
 */
export function EvalDoneBody({
	read,
	lead,
}: {
	read: EvalDoneReport;
	lead: boolean;
}): JSX.Element {
	const conversation = useContext(EvalsConversation);
	const [grid, setGrid] = useState<EvalGrid | null>(null);
	const [budget, setBudget] = useState<number | null>(null);
	useEffect(() => {
		let current = true;
		evalBatch(read.batch).then(
			(found) => current && setGrid(found),
			() => undefined,
		);
		if (conversation !== null) {
			evalBudget(conversation).then(
				(status) => current && setBudget(status.budget.usd),
				() => undefined,
			);
		}
		return () => {
			current = false;
		};
	}, [read.batch, conversation]);
	return (
		<>
			{read.outcome !== "" && <CardBody text={read.outcome} lead={lead} />}
			<div className="mx-4 mb-3 text-sm">
				{grid === null ? (
					<a
						href={`#evals/${encodeURIComponent(read.batch)}`}
						className="text-info text-xs underline"
					>
						Open the report
					</a>
				) : (
					<EvalRunRecord
						grid={grid}
						running={false}
						stopped={false}
						budget={budget}
					/>
				)}
			</div>
		</>
	);
}
