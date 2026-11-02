import type {
	EvalBatch,
	EvalGrid,
	EvalScenario,
} from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	addTodo,
	evalBatch,
	evalBatches,
	evalScenarios,
	queueTodo,
} from "./api";
import { ReadingNow } from "./countdown";
import {
	type LastResult,
	lastResults,
	loopTask,
	sectionsOf,
} from "./eval-scenarios";
import { EvalSection } from "./eval-section";
import { StatusChip } from "./eval-status";

/**
 * Every scenario the project lists, under its skill, with how it last went
 * and a link to its latest report. Browsing costs
 * no tokens.
 */
export function EvalScenarios({
	onOpenBatch,
}: {
	onOpenBatch: (batch: string) => void;
}): JSX.Element {
	const [scenarios, setScenarios] = useState<EvalScenario[] | null>(null);
	const [history, setHistory] = useState<EvalGrid[]>([]);
	const [last, setLast] = useState<Map<string, LastResult>>(new Map());
	const [error, setError] = useState<string | null>(null);
	const [picked, setPicked] = useState<string[]>([]);
	const [asking, setAsking] = useState(false);
	const [pending, setPending] = useState(false);
	const toggle = (ids: string[], on: boolean): void =>
		setPicked((now) =>
			on
				? [...new Set([...now, ...ids])]
				: now.filter((each) => !ids.includes(each)),
		);
	// Each eval is its own queued task, so each runs as one agent's work.
	const enqueue = async (): Promise<void> => {
		setAsking(false);
		setPending(true);
		setError(null);
		const left = [...picked];
		try {
			for (const id of picked) {
				const { subject, text } = loopTask(id);
				await queueTodo(await addTodo({ subject, text }, []), true);
				left.splice(left.indexOf(id), 1);
			}
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		}
		// What did not get queued stays picked, to try again.
		setPicked(left);
		setPending(false);
	};
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
					(Array.isArray(batches) ? batches : []).map((each) =>
						evalBatch(each.id),
					),
				);
				if (current) {
					setHistory(grids);
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
				sectionsOf(scenarios).map((section) => {
					return (
						<EvalSection
							key={section.heading}
							label={section.heading === "" ? "Scenarios" : section.heading}
							title={section.heading === "" ? "Scenarios" : section.heading}
							count={section.scenarios.length}
						>
							<span className="flex items-center justify-end gap-2 pt-3 pb-3 text-muted-foreground text-xs">
								Select all
								<Checkbox
									aria-label={`Select all ${section.heading === "" ? "scenarios" : section.heading}`}
									checked={section.scenarios.every((each) =>
										picked.includes(each.id),
									)}
									disabled={pending}
									onCheckedChange={(on) =>
										toggle(
											section.scenarios.map((each) => each.id),
											on,
										)
									}
								/>
							</span>
							<ul className="flex flex-col divide-y">
								{section.scenarios.map((scenario) => {
									const result = last.get(scenario.id);
									return (
										<li
											key={scenario.id}
											className="flex min-w-0 items-center gap-3 py-2"
										>
											<Checkbox
												aria-label={`Select ${scenario.id}`}
												checked={picked.includes(scenario.id)}
												disabled={pending}
												onCheckedChange={(on) => toggle([scenario.id], on)}
											/>
											<div className="flex min-w-0 flex-1 flex-col">
												<code className="break-all text-sm">{scenario.id}</code>
												<details className="text-xs">
													<summary className="cursor-pointer text-muted-foreground">
														Scenario details and history
													</summary>
													<p className="py-1">
														{scenario.about ?? "No description supplied."}
													</p>
													<ul>
														{history
															.filter((grid) =>
																grid.grid.some(
																	(cell) => cell.scenario === scenario.id,
																),
															)
															.map((grid) => (
																<li key={grid.id}>
																	<button
																		type="button"
																		className="text-info underline"
																		onClick={() => onOpenBatch(grid.id)}
																	>
																		{new Date(grid.startedAt).toLocaleString()}{" "}
																		· {grid.id}
																	</button>
																</li>
															))}
													</ul>
												</details>
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
														{result.passed}/{result.cells} pass
													</span>
												</button>
											)}
										</li>
									);
								})}
							</ul>
						</EvalSection>
					);
				})
			)}
			{picked.length > 0 && (
				<div className="sticky bottom-0 -mx-1 bg-background/90 px-1 py-3 backdrop-blur">
					<Button
						className="min-h-11 w-full"
						disabled={pending}
						onClick={() =>
							picked.length > 1 ? setAsking(true) : void enqueue()
						}
					>
						{pending
							? "Enqueuing…"
							: `Enqueue ${picked.length} eval ${picked.length === 1 ? "loop" : "loops"}`}
					</Button>
				</div>
			)}
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Enqueue {picked.length} eval loops?</DialogTitle>
						<DialogDescription>
							Each becomes its own queued task, and an agent starts on each as
							the queue reaches it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Cancel
						</DialogClose>
						<Button onClick={() => void enqueue()}>Enqueue all</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
