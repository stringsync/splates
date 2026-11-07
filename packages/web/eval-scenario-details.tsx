import type {
	EvalDetail,
	EvalScenario,
	EvalScenarioState,
} from "@splates/server/evals/browser";
import { targetName, targetOf } from "@splates/server/evals/browser";
import type { AgentPick } from "@splates/server/models";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { evalRun } from "./api";
import { CardSection } from "./card-section";
import { ReadingNow } from "./countdown";
import { ScenarioHistory } from "./eval-scenario-history";
import { passCount } from "./eval-scenarios";
import { StatusChip } from "./eval-status";

/**
 * Show an opened scenario's prompt, how it is judged and how its last run
 * went, with older runs behind History. Pass run as null for a scenario never
 * run, which says so, and onOpenBatch to open a report.
 */
export function ScenarioDetails({
	scenario,
	state,
	saved,
	onOpenBatch,
}: {
	scenario: EvalScenario;
	/** Where the scenario stands; its `run` is the run to show. */
	state: EvalScenarioState;
	/** The saved agents, each shown with its passed of total. */
	saved: readonly AgentPick[];
	onOpenBatch: (batch: string) => void;
}): JSX.Element {
	// Read from the run, since the project's list says none of this.
	const id = state.run;
	const [run, setRun] = useState<EvalDetail | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [history, setHistory] = useState(false);
	useEffect(() => {
		if (id === null) {
			return;
		}
		let current = true;
		evalRun(id).then(
			(each) => current && setRun(each),
			(error: unknown) =>
				current &&
				setFailed(error instanceof Error ? error.message : String(error)),
		);
		return () => {
			current = false;
		};
	}, [id]);
	if (id === null) {
		return (
			<p className="text-muted-foreground text-xs">
				This has not run yet. Its prompt and how it is judged show after its
				first run.
			</p>
		);
	}
	if (failed !== null) {
		return (
			<p role="alert" className="text-destructive text-xs">
				{failed}
			</p>
		);
	}
	if (run === null) {
		return <ReadingNow label="Reading the last run…" />;
	}
	return (
		<div className="flex min-w-0 flex-col gap-4">
			{run.input !== "" && (
				<Part title="Prompt">
					<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm">
						{run.input}
					</pre>
				</Part>
			)}
			<Part title="How it is judged">
				{run.rubric === null && run.checks.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						This run has no checks and no judge.
					</p>
				) : (
					<>
						{run.rubric !== null && <p className="text-sm">{run.rubric}</p>}
						{run.checks.length > 0 && (
							<ul className="flex flex-col gap-1 text-sm">
								{run.checks.map((check) => (
									<li key={check.id} className="flex items-start gap-2">
										<StatusChip status={check.pass ? "pass" : "fail"} />
										<span className="min-w-0">{check.about}</span>
									</li>
								))}
							</ul>
						)}
					</>
				)}
			</Part>
			{saved.length > 0 && (
				<Part title="Agents">
					<ul className="flex flex-col gap-1 text-sm">
						{saved.map((pick) => (
							<li key={targetOf(pick)} className="flex gap-2">
								<span className="text-muted-foreground">{targetOf(pick)}</span>
								<span>{passCount(state, pick) ?? "n/a"}</span>
							</li>
						))}
					</ul>
				</Part>
			)}
			<Part title="Last run">
				<span className="flex flex-wrap items-center gap-2 text-sm">
					<StatusChip status={run.status} />
					<span className="text-muted-foreground">
						on {targetName(run.target)}
					</span>
				</span>
				{run.error !== undefined && (
					<p className="text-destructive text-sm">{run.error}</p>
				)}
				{run.judge !== null && <p className="text-sm">{run.judge.reason}</p>}
				<span className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						className="text-info text-xs underline"
						onClick={() => onOpenBatch(id.split("#")[0] ?? id)}
					>
						Open report
					</button>
					<button
						type="button"
						aria-expanded={history}
						className="text-info text-xs underline"
						onClick={() => setHistory(!history)}
					>
						{history ? "Hide history" : "History"}
					</button>
				</span>
				{history && (
					<ScenarioHistory scenario={scenario} onOpenBatch={onOpenBatch} />
				)}
			</Part>
		</div>
	);
}

function Part({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<CardSection label={title} title={title}>
			{children}
		</CardSection>
	);
}
