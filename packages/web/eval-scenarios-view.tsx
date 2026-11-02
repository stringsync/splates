import type {
	EvalBatch,
	EvalGrid,
	EvalScenario,
	StoredEvalLoop,
} from "@splates/server/evals/browser";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { answered, evalBatch, evalBatches, evalScenarios, scoped } from "./api";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
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
	feed = null,
}: {
	onOpenBatch: (batch: string) => void;
	/** Where a conversation started from here is shown; null while there is none to start. */
	feed?: ConversationFeed | null;
}): JSX.Element {
	const [scenarios, setScenarios] = useState<EvalScenario[] | null>(null);
	const [history, setHistory] = useState<EvalGrid[]>([]);
	const [last, setLast] = useState<Map<string, LastResult>>(new Map());
	const [error, setError] = useState<string | null>(null);
	// The conversation working each scenario: one an improvement loop is
	// recorded in, or one started from this page.
	const [working, setWorking] = useState<Map<string, string>>(new Map());
	const [asking, setAsking] = useState<string[] | null>(null);
	const [pending, setPending] = useState<string[]>([]);
	const [started, setStarted] = useState(0);
	const busy = (id: string): boolean => pending.includes(id) || working.has(id);
	// Each eval is its own conversation, told the directive to work its loop.
	const start = async (ids: string[]): Promise<void> => {
		const todo = ids.filter((id) => !busy(id));
		if (feed === null || todo.length === 0) {
			return;
		}
		setAsking(null);
		setPending(todo);
		setError(null);
		setStarted(0);
		let count = 0;
		let opened = "";
		try {
			for (const id of todo) {
				const { text } = loopTask(id);
				const state = await startAutoPick({ words: text, task: null });
				feed.put(state);
				const sending = feed.send(state.id, text);
				void promptConversation(state.id, text, [], false, sending.id)
					.then((reply) => feed.answered(state.id, sending, reply))
					.catch((failed: unknown) => feed.refused(state.id, sending, failed));
				setWorking((now) => new Map(now).set(id, state.id));
				opened = state.id;
				count += 1;
			}
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		}
		setStarted(count);
		setPending([]);
		// One conversation is the one to watch; several are found in the list.
		if (count === 1) {
			location.hash = `conversations/${opened}`;
		}
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
		answered(scoped("/api/evals/loop"))
			.then(async (response) => {
				if (!response.ok) {
					return;
				}
				const body = (await response.json()) as StoredEvalLoop[] | unknown;
				const saved = Array.isArray(body) ? (body as StoredEvalLoop[]) : [];
				if (current) {
					setWorking((now) => {
						const next = new Map(now);
						for (const each of saved) {
							if (
								each.loop.stage.kind !== "complete" &&
								each.loop.stage.kind !== "stopped"
							) {
								next.set(each.loop.contract.scenario, each.conversation);
							}
						}
						return next;
					});
				}
			})
			.catch(() => {});
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
							<SectionStart
								ids={section.scenarios.map((each) => each.id)}
								busy={busy}
								working={pending.length > 0}
								ready={feed !== null}
								onStart={(ids) =>
									ids.length > 1 ? setAsking(ids) : void start(ids)
								}
							/>
							<ul className="flex flex-col divide-y">
								{section.scenarios.map((scenario) => {
									const result = last.get(scenario.id);
									return (
										<li
											key={scenario.id}
											className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-2"
										>
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
											<StartButton
												id={scenario.id}
												conversation={working.get(scenario.id) ?? null}
												pending={pending.includes(scenario.id)}
												ready={feed !== null}
												onStart={() => void start([scenario.id])}
											/>
										</li>
									);
								})}
							</ul>
						</EvalSection>
					);
				})
			)}
			{started > 1 && (
				<p
					role="status"
					className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-x-2 bg-background/90 px-1 py-3 text-sm backdrop-blur"
				>
					Started {started} conversations, one per eval.
					<a className="text-info underline" href="#conversations">
						Open conversations
					</a>
				</p>
			)}
			<Dialog
				open={asking !== null}
				onOpenChange={(open) => !open && setAsking(null)}
			>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Start {asking?.length} conversations?</DialogTitle>
						<DialogDescription>
							Each eval gets its own conversation, told to work its loop. Evals
							already being worked are skipped.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Cancel
						</DialogClose>
						<Button onClick={() => void start(asking ?? [])}>Start all</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

/** One scenario's call to action: start its conversation, or open the one already working it. */
function StartButton({
	id,
	conversation,
	pending,
	ready,
	onStart,
}: {
	id: string;
	conversation: string | null;
	pending: boolean;
	ready: boolean;
	onStart: () => void;
}): JSX.Element {
	if (conversation !== null) {
		return (
			<Button
				size="sm"
				variant="outline"
				className="min-h-9"
				aria-label={`Open the conversation for ${id}`}
				render={
					<a href={`#conversations/${encodeURIComponent(conversation)}`} />
				}
			>
				Open conversation
			</Button>
		);
	}
	return (
		<Button
			size="sm"
			className="min-h-9"
			disabled={pending || !ready}
			aria-label={`Start ${id}`}
			onClick={onStart}
		>
			{pending ? "Starting…" : "Start"}
		</Button>
	);
}

/** A section's call to action: start every scenario in it not already being worked. */
function SectionStart({
	ids,
	busy,
	working,
	ready,
	onStart,
}: {
	ids: string[];
	busy: (id: string) => boolean;
	working: boolean;
	ready: boolean;
	onStart: (ids: string[]) => void;
}): JSX.Element {
	const open = ids.filter((id) => !busy(id));
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 py-3 text-muted-foreground text-xs">
			<span>
				{open.length === 0
					? "All started"
					: `${open.length} of ${ids.length} not yet started`}
			</span>
			{open.length > 0 && (
				<Button
					size="sm"
					variant="outline"
					className="min-h-9"
					disabled={working || !ready}
					onClick={() => onStart(open)}
				>
					{working ? "Starting…" : `Start all ${open.length}`}
				</Button>
			)}
		</div>
	);
}
