import type { EvalGrid, StoredEvalLoop } from "@splates/server/evals/browser";
import { FlaskConicalIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { evalBatch } from "./api/evals";
import { answered, scoped } from "./api/request";
import { useCardReply } from "./card-reply";
import { CardShell } from "./card-shell";
import { EvalAgentsEditor } from "./eval-agents";
import { EvalAgentsView } from "./eval-agents-view";
import { Refusal, useRefusal } from "./refusal";

export function loopStep(saved: StoredEvalLoop): string {
	switch (saved.loop.stage.kind) {
		case "baseline-awaiting-run":
		case "baseline-running":
			return "Baseline";
		case "baseline-diagnosing":
			return "Diagnose";
		case "editing":
		case "awaiting-comparison":
			return "Experiment";
		case "comparing":
			return "Compare";
		case "deciding":
		case "complete":
		case "stopped":
			return "Decision";
	}
}

/** A historical projection: mutations are requests to the conversation's agent. */
export function EvalLoopCard({
	reference,
}: {
	reference: { id: string; version: number };
}): JSX.Element {
	const [saved, setSaved] = useState<StoredEvalLoop | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		void answered(
			scoped(
				`/api/evals/loop?id=${encodeURIComponent(reference.id)}&version=${reference.version}`,
			),
		)
			.then(async (response) => {
				if (!response.ok) {
					throw new Error("Could not read this loop version");
				}
				const record = (await response.json()) as StoredEvalLoop;
				if (active) {
					setSaved(record);
				}
			})
			.catch((error: unknown) => {
				if (active) {
					setProblem(String(error));
				}
			});
		return () => {
			active = false;
		};
	}, [reference.id, reference.version]);
	if (saved === null) {
		return (
			<CardShell
				label="eval loop"
				Icon={FlaskConicalIcon}
				title={problem ?? "Loading eval loop"}
			/>
		);
	}
	return <EvalLoopView saved={saved} />;
}

export function EvalLoopView({
	saved,
}: {
	saved: StoredEvalLoop;
}): JSX.Element {
	const { loop } = saved;
	const step = loopStep(saved);
	const stage = loop.stage;
	const round = "round" in stage ? stage.round : undefined;
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	const [editor] = useState(() => new EvalAgentsEditor());
	const [configuring, setConfiguring] = useState(false);
	const [repetitions, setRepetitions] = useState(loop.contract.repetitions);
	const request = (action: string): void => {
		if (reply?.send != null) {
			void attempt(
				reply.send(
					`[SPLATES EVAL LOOP ${saved.id} at ${saved.version}]\n\n${action}`,
				),
				"Request not sent",
			);
		}
	};
	const next =
		step === "Baseline"
			? "Prepare baseline run"
			: step === "Diagnose"
				? "Inspect failures and diagnose one layer"
				: step === "Experiment"
					? "Prepare comparison run"
					: null;
	return (
		<CardShell
			label={`eval loop ${saved.id}`}
			Icon={FlaskConicalIcon}
			title={`${step} · ${loop.contract.scenario}`}
			tone="info"
			aside={<span className="text-xs">v{saved.version}</span>}
		>
			<div className="flex min-w-0 flex-col gap-4 px-4 py-3 text-sm [overflow-wrap:anywhere]">
				<ol
					aria-label="Eval journey"
					className="flex flex-wrap gap-2 text-xs text-muted-foreground"
				>
					{["Baseline", "Diagnose", "Experiment", "Compare", "Decision"].map(
						(name) => (
							<li key={name} aria-current={step === name ? "step" : undefined}>
								{name === step ? (
									<strong className="text-foreground">{name}</strong>
								) : (
									name
								)}
							</li>
						),
					)}
				</ol>
				<p>
					{step === "Baseline"
						? "Establish repeatable evidence before editing."
						: step === "Diagnose"
							? "Inspect each failure before choosing one layer to change."
							: step === "Experiment"
								? "Change one layer; keep the test contract frozen."
								: step === "Compare"
									? "Compare every repetition against the accepted baseline."
									: "Keep or revert with a reason, preserving what this round taught."}
				</p>
				<dl className="grid grid-cols-2 gap-3 text-xs">
					<Fact label="Frozen suite" value={loop.contract.suiteRevision} />
					<Fact
						label="Target"
						value={Object.values(loop.contract.target).join(" · ")}
					/>
					<Fact label="Repetitions" value={String(loop.contract.repetitions)} />
					<Fact
						label="Baseline"
						value={loop.baseline?.revision ?? loop.revision}
					/>
					<Fact
						label="Stopping rule"
						value={`${loop.contract.repetitions}/${loop.contract.repetitions} pass or 3 no-gain rounds`}
					/>
					<Fact label="No-gain rounds" value={String(loop.noGainCount)} />
				</dl>
				{round !== undefined && (
					<section className="flex flex-col gap-2 rounded-lg bg-muted p-3">
						<strong>Round {round.number} · One layer</strong>
						<p>{round.diagnosis}</p>
						<p>
							<strong>Hypothesis:</strong> {round.hypothesis}
						</p>
						{round.candidateRevision !== undefined && (
							<p>Candidate: {round.candidateRevision}</p>
						)}
					</section>
				)}
				{loop.baseline !== undefined && (
					<Evidence
						id={loop.baseline.batchId}
						title="Accepted baseline"
						results={loop.baseline.results}
					/>
				)}
				{round?.comparison !== undefined && (
					<>
						<Evidence
							id={round.comparison.batch.id}
							title="Fresh baseline"
							revision={round.baseline.revision}
							results={round.comparison.baselineResults ?? []}
						/>
						<Evidence
							id={round.comparison.batch.id}
							title="Candidate"
							results={round.comparison.results}
						/>
					</>
				)}
				{stage.kind === "baseline-running" || stage.kind === "comparing" ? (
					<p>
						Running batch{" "}
						<a
							className="underline"
							href={`#evals/${encodeURIComponent(stage.batch.id)}`}
						>
							{stage.batch.id}
						</a>
					</p>
				) : null}
				{stage.kind === "complete" && (
					<p>All repetitions passing. Loop complete.</p>
				)}
				{stage.kind === "stopped" && (
					<p>
						Stopped: {stage.reason}. {stage.detail}
					</p>
				)}
				{loop.rounds.length > 0 && (
					<details>
						<summary>Round history ({loop.rounds.length})</summary>
						<ol className="flex flex-col gap-3 pt-3">
							{loop.rounds.map((each) => (
								<li key={each.number} className="rounded-lg border p-3">
									<strong>
										Round {each.number} · {each.decision?.action}
									</strong>
									<p>{each.hypothesis}</p>
									<p>Learned: {each.decision?.reason}</p>
									<p>Candidate: {each.candidateRevision}</p>
									{each.comparison !== undefined && (
										<Evidence
											id={each.comparison.batch.id}
											title="Comparison"
											results={each.comparison.results}
										/>
									)}
								</li>
							))}
						</ol>
					</details>
				)}
				{configuring && (
					<section className="flex flex-col gap-3">
						<EvalAgentsView editor={editor} />
						<label>
							Repetitions
							<input
								aria-label="Loop repetitions"
								type="number"
								min={1}
								value={repetitions}
								onChange={(event) => setRepetitions(Number(event.target.value))}
								className="ml-2 w-20 rounded border p-2"
							/>
						</label>
						<Button
							variant="outline"
							disabled={
								!Number.isSafeInteger(repetitions) ||
								repetitions < 1 ||
								reply === null
							}
							onClick={() =>
								request(
									`Reconfigure the target from my saved agents and use ${repetitions} repetitions. Confirm the target in conversation; rebaseline if the frozen contract changes.`,
								)
							}
						>
							Request configuration
						</Button>
					</section>
				)}
			</div>
			<div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setConfiguring(!configuring)}
				>
					Configure
				</Button>
				{next !== null && (
					<Button
						size="sm"
						disabled={reply === null || sent !== null}
						onClick={() => request(next)}
					>
						{next}
					</Button>
				)}
				{stage.kind === "deciding" &&
					["Keep", "Revert"].map((action) => (
						<Button
							key={action}
							variant="outline"
							size="sm"
							disabled={reply === null || sent !== null}
							onClick={() =>
								request(
									`${action} this candidate. Record the evidence-based reason and apply the decision in the linked code task.`,
								)
							}
						>
							{action}
						</Button>
					))}
			</div>
			<Refusal refusal={refusal} className="mx-4 mb-3" />
		</CardShell>
	);
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div>
			<dt className="text-muted-foreground">{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

function Evidence({
	id,
	title,
	results,
	revision,
}: {
	id: string;
	title: string;
	results: readonly string[];
	revision?: string;
}): JSX.Element {
	const [grid, setGrid] = useState<EvalGrid | null>(null);
	useEffect(() => {
		let active = true;
		void evalBatch(id)
			.then((value) => {
				if (active) {
					setGrid(value);
				}
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [id]);
	return (
		<section className="flex flex-col gap-2 rounded-lg border p-3">
			<strong>
				{title} · {results.filter((each) => each === "pass").length}/
				{results.length} pass
			</strong>
			<div className="flex flex-wrap gap-2">
				{results.map((result, index) => {
					const target = grid?.targets.find(
						(each) => each.skill === (revision ?? null),
					);
					const cell = grid?.grid.find(
						(each) => each.repetition === index && each.target === target?.key,
					);
					const href = `#evals/${encodeURIComponent(id)}${cell?.run == null ? "" : `/${encodeURIComponent(cell.run.id)}`}`;
					return (
						<a
							// biome-ignore lint/suspicious/noArrayIndexKey: Repetition position is the immutable evidence identity.
							key={index}
							href={href}
							className="rounded border px-2 py-1 text-xs underline"
							aria-label={`${title} repetition ${index + 1}: ${result}`}
						>
							{index + 1}: {result}
							{cell?.run?.reason ? ` · ${cell.run.reason}` : ""}
						</a>
					);
				})}
			</div>
			<a
				className="text-info underline"
				href={`#evals/${encodeURIComponent(id)}`}
			>
				Open evidence and individual runs
			</a>
			<p className="text-muted-foreground text-xs">
				Batch cost:{" "}
				{grid?.costUsd == null ? "unavailable" : `$${grid.costUsd.toFixed(2)}`}
			</p>
		</section>
	);
}
