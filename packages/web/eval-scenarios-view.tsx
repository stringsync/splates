import type {
	EvalBatch,
	EvalCheck,
	EvalGrid,
	EvalScenario,
} from "@splates/server/evals/browser";
import { FlaskConicalIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
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
import { evalBatch, evalBatches, evalRun, evalScenarios } from "./api";
import { CardShell } from "./card-shell";
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
import { HEADING } from "./markdown";

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
	// The conversation Start opened for each scenario, kept across reloads
	// and counted as working until it is archived or gone.
	const [opened, setOpened] = useState<Map<string, string>>(() => readOpened());
	const [, redraw] = useState(0);
	useEffect(() => feed?.subscribe(() => redraw((count) => count + 1)), [feed]);
	const working = new Map(
		[...opened].filter(([, id]) => {
			const state = feed?.current(id);
			return state !== undefined && !state.archived;
		}),
	);
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
				setOpened((now) => {
					const next = new Map(now).set(id, state.id);
					writeOpened(next);
					return next;
				});
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
							<ul className="flex flex-col gap-3">
								{section.scenarios.map((scenario) => {
									const result = last.get(scenario.id);
									return (
										<ScenarioCard
											key={scenario.id}
											scenario={scenario}
											result={result}
											history={history}
											onOpenBatch={onOpenBatch}
										>
											<StartButton
												id={scenario.id}
												conversation={working.get(scenario.id) ?? null}
												pending={pending.includes(scenario.id)}
												ready={feed !== null}
												onStart={() => void start([scenario.id])}
											/>
										</ScenarioCard>
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

const OPENED_KEY = "splates.evals.conversations";

function readOpened(): Map<string, string> {
	try {
		const saved = JSON.parse(localStorage.getItem(OPENED_KEY) ?? "{}");
		return new Map(
			Object.entries(saved).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return new Map();
	}
}

function writeOpened(opened: Map<string, string>): void {
	try {
		localStorage.setItem(
			OPENED_KEY,
			JSON.stringify(Object.fromEntries(opened)),
		);
	} catch {}
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

/**
 * One eval as a card: what it is about, the outcomes its latest report
 * checked, and how it last went, with the call to action in its footer.
 */
function ScenarioCard({
	scenario,
	result,
	history,
	onOpenBatch,
	children,
}: {
	scenario: EvalScenario;
	result: LastResult | undefined;
	history: EvalGrid[];
	onOpenBatch: (batch: string) => void;
	children: ReactNode;
}): JSX.Element {
	const [checks, setChecks] = useState<EvalCheck[]>([]);
	const run = result?.run ?? null;
	useEffect(() => {
		let current = true;
		setChecks([]);
		if (run !== null) {
			evalRun(run).then(
				(detail) => current && setChecks(detail.checks ?? []),
				() => {},
			);
		}
		return () => {
			current = false;
		};
	}, [run]);
	const earlier = history.filter((grid) =>
		grid.grid.some((cell) => cell.scenario === scenario.id),
	).length;
	return (
		<li className="min-w-0 [&>section]:my-0">
			<CardShell
				label={scenario.id}
				Icon={FlaskConicalIcon}
				title={scenario.id}
				tone="info"
				aside={
					result === undefined ? (
						<span className="text-muted-foreground text-xs">never run</span>
					) : (
						<span className="flex items-center gap-1.5">
							<StatusChip status={result.status} />
							<span className="text-xs tabular-nums">
								{result.passed}/{result.cells} pass
							</span>
						</span>
					)
				}
			>
				<div className="flex flex-col gap-3 px-4 py-3.5 @max-md:px-3 @max-md:py-2.5">
					<Part title="About">
						<p className="text-sm">
							{scenario.about ?? "No description supplied."}
						</p>
					</Part>
					{result !== undefined && result.requirement !== "" && (
						<Part title="Testing">
							<p className="text-sm">{result.requirement}</p>
						</Part>
					)}
					{checks.length > 0 && (
						<Part title="Outcomes wanted">
							<ul className="list-disc pl-5 text-sm">
								{checks.map((check) => (
									<li key={check.id}>{check.about}</li>
								))}
							</ul>
						</Part>
					)}
					<div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
						{result === undefined ? (
							<span className="text-muted-foreground text-xs">No runs yet</span>
						) : (
							<button
								type="button"
								aria-label={`Report of ${scenario.id}`}
								className="text-info text-xs underline"
								onClick={() => onOpenBatch(result.batch)}
							>
								Last run {new Date(result.startedAt).toLocaleString()} · report
								{earlier > 1 ? ` · ${earlier - 1} earlier` : ""}
							</button>
						)}
						{children}
					</div>
				</div>
			</CardShell>
		</li>
	);
}

/** One labelled part of a card's body. */
function Part({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="flex flex-col">
			<h3 className={HEADING}>{title}</h3>
			{children}
		</div>
	);
}
