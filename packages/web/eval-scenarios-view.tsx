import type {
	EvalBatch,
	EvalGrid,
	EvalScenario,
} from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { evalBatch, evalBatches, evalScenarios } from "./api";
import { ReadingNow } from "./countdown";
import { type LastResult, lastResults, sectionsOf } from "./eval-scenarios";
import { EvalSection } from "./eval-section";
import { StatusChip } from "./eval-status";

/** How many of the newest batches are read for each scenario's last result. */
const RECENT = 8;

/**
 * Every scenario the project lists, under its skill, with how it last went
 * and a Plan button that opens what a run of it would cost. Browsing costs
 * no tokens.
 */
export function EvalScenarios({
	onPlan,
	onOpenBatch,
}: {
	onPlan: (scenarios: string[]) => void;
	onOpenBatch: (batch: string) => void;
}): JSX.Element {
	const [scenarios, setScenarios] = useState<EvalScenario[] | null>(null);
	const [last, setLast] = useState<Map<string, LastResult>>(new Map());
	const [error, setError] = useState<string | null>(null);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const toggle = (ids: string[], on: boolean): void =>
		setPicked((before) => {
			const after = new Set(before);
			for (const id of ids) {
				if (on) {
					after.add(id);
				} else {
					after.delete(id);
				}
			}
			return after;
		});
	useEffect(() => {
		let current = true;
		const fail = (failed: unknown): void => {
			if (current) {
				setError(failed instanceof Error ? failed.message : String(failed));
			}
		};
		evalScenarios().then(
			(each) => current && setScenarios(Array.isArray(each) ? each : []),
			fail,
		);
		evalBatches()
			.then(async (batches: EvalBatch[] | null) => {
				const grids: EvalGrid[] = await Promise.all(
					(Array.isArray(batches) ? batches : [])
						.slice(0, RECENT)
						.map((each) => evalBatch(each.id)),
				);
				if (current) {
					setLast(lastResults(grids));
				}
			})
			.catch(fail);
		return () => {
			current = false;
		};
	}, []);
	return (
		<section aria-label="scenarios" className="flex min-w-0 flex-col gap-4">
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{scenarios === null ? (
				error === null && <ReadingNow label="Reading scenarios…" />
			) : scenarios.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					This project lists no eval scenarios.
				</p>
			) : (
				<>
					{picked.size > 0 && (
						<div className="flex items-center gap-3">
							<Button
								size="sm"
								onClick={() =>
									onPlan(
										scenarios
											.map((each) => each.id)
											.filter((id) => picked.has(id)),
									)
								}
							>
								Plan {picked.size} selected
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setPicked(new Set())}
							>
								Clear
							</Button>
						</div>
					)}
					{sectionsOf(scenarios).map((section) => {
						const ids = section.scenarios.map((each) => each.id);
						const chosen = ids.filter((id) => picked.has(id));
						const label =
							section.heading === "" ? "Scenarios" : section.heading;
						return (
							<EvalSection
								key={section.heading}
								label={section.heading === "" ? "Scenarios" : section.heading}
								title={section.heading === "" ? "Scenarios" : section.heading}
								count={section.scenarios.length}
							>
								<div className="flex items-center gap-3 py-2 text-sm">
									<label className="flex items-center gap-2">
										<input
											type="checkbox"
											aria-label={`Select all of ${label}`}
											checked={chosen.length === ids.length}
											ref={(box) => {
												if (box !== null) {
													box.indeterminate =
														chosen.length > 0 && chosen.length < ids.length;
												}
											}}
											onChange={(event) => toggle(ids, event.target.checked)}
										/>
										Select all
									</label>
								</div>
								<ul className="flex flex-col divide-y">
									{section.scenarios.map((scenario) => {
										const result = last.get(scenario.id);
										return (
											<li
												key={scenario.id}
												className="flex min-w-0 items-center gap-3 py-2"
											>
												<input
													type="checkbox"
													aria-label={`Select ${scenario.id}`}
													checked={picked.has(scenario.id)}
													onChange={(event) =>
														toggle([scenario.id], event.target.checked)
													}
												/>
												<div className="flex min-w-0 flex-1 flex-col">
													<code className="truncate text-sm">
														{scenario.id}
													</code>
													{scenario.about !== null && (
														<span className="text-muted-foreground text-xs">
															{scenario.about}
														</span>
													)}
												</div>
												{result === undefined ? (
													<span className="text-muted-foreground text-xs">
														never run
													</span>
												) : (
													<button
														type="button"
														aria-label={`Report of ${scenario.id}`}
														onClick={() => onOpenBatch(result.batch)}
														className="flex items-center gap-1.5"
													>
														<StatusChip status={result.status} />
														<span className="text-xs tabular-nums">
															{result.passed}/{result.cells}
														</span>
													</button>
												)}
												<Button
													size="sm"
													variant="outline"
													onClick={() => onPlan([scenario.id])}
												>
													Plan
												</Button>
											</li>
										);
									})}
								</ul>
							</EvalSection>
						);
					})}
				</>
			)}
		</section>
	);
}
