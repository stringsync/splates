import type {
	EvalDetail,
	EvalStep,
} from "@stringsync/splates-server/evals/browser";
import { targetName } from "@stringsync/splates-server/evals/browser";
import { ArrowLeftIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { evalRun } from "./api";
import { ReadingNow } from "./countdown";
import { ImproveMenu, improvable } from "./eval-improve";
import { StatusChip, spent } from "./eval-status";
import { EvalReply } from "./evals-reply";

/**
 * One run opened to see why it went as it did: what it asked, what broke if
 * it broke, each code check, the judge's verdict and reason, the reply drawn
 * as the cards a person would meet, and every step the agent took.
 */
export function EvalDebug({
	id,
	onBack,
}: {
	id: string;
	onBack: () => void;
}): JSX.Element {
	const [run, setRun] = useState<EvalDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setRun(null);
		evalRun(id).then(setRun, (failed: unknown) =>
			setError(failed instanceof Error ? failed.message : String(failed)),
		);
	}, [id]);
	return (
		<section aria-label="eval run" className="flex min-w-0 flex-col gap-5">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="self-start"
				onClick={onBack}
			>
				<ArrowLeftIcon /> Report
			</Button>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{run === null && error === null && (
				<ReadingNow label="Reading the run…" />
			)}
			{run !== null && <Run run={run} />}
		</section>
	);
}

function Run({ run }: { run: EvalDetail }): JSX.Element {
	return (
		<>
			<header className="flex flex-col gap-1">
				<span className="flex flex-wrap items-center gap-2">
					<StatusChip status={run.status} />
					<h2 className="font-medium">{run.scenario}</h2>
					<span className="text-muted-foreground text-sm">
						on {targetName(run.target)}
						{run.repetition > 0 && `, repetition ${run.repetition + 1}`}
					</span>
				</span>
				<p className="text-muted-foreground text-xs">
					{[
						run.aspect,
						run.score === undefined ? "" : `score ${run.score.toFixed(2)}`,
						spent(run),
					]
						.filter((part) => part !== "")
						.join(" · ")}
				</p>
				<p className="text-sm">{run.requirement}</p>
				{run.reason !== undefined && run.error === undefined && (
					<p className="text-sm">{run.reason}</p>
				)}
				{run.url !== undefined && (
					<a
						href={run.url}
						target="_blank"
						rel="noreferrer"
						className="text-sm underline"
					>
						Open in its framework
					</a>
				)}
				{improvable(run.status) && <ImproveMenu run={run} className="mt-1" />}
			</header>
			{run.error !== undefined && (
				<p role="alert" className="text-destructive text-sm">
					The run broke before it could be graded: {run.error}
				</p>
			)}
			{run.input !== "" && (
				<Part title="Asked">
					<pre className="whitespace-pre-wrap text-sm">{run.input}</pre>
				</Part>
			)}
			{run.checks.length > 0 && (
				<Part
					title={`Checks: ${run.checks.filter((check) => check.pass).length} of ${run.checks.length} pass`}
				>
					<ul className="flex flex-col gap-1 text-sm">
						{run.checks.map((check) => (
							<li key={check.id} className="flex flex-wrap items-center gap-2">
								<StatusChip status={check.pass ? "pass" : "fail"} />
								<span className="font-medium">{check.id}</span>
								<span className="text-muted-foreground">{check.about}</span>
								{check.error !== undefined && (
									<span className="text-destructive text-xs">
										{check.error}
									</span>
								)}
							</li>
						))}
					</ul>
				</Part>
			)}
			{run.judge !== null && (
				<Part title="Judge">
					<div className="flex flex-col gap-1 text-sm">
						<span className="flex items-center gap-2">
							<StatusChip status={run.judge.pass ? "pass" : "fail"} />
							{run.judge.reason}
						</span>
						{run.rubric !== null && (
							<p className="text-muted-foreground text-xs">
								Asked: {run.rubric}
							</p>
						)}
					</div>
				</Part>
			)}
			<Part title="Reply">
				{run.reply === "" ? (
					<p className="text-muted-foreground text-sm">No reply.</p>
				) : (
					<EvalReply text={run.reply} />
				)}
			</Part>
			<Part title={`Transcript: ${run.transcript.length} steps`}>
				<ol className="flex flex-col gap-2 text-xs">
					{run.transcript.map((step, index) => (
						// Steps are only ever appended, so their place is their identity.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						<Step key={index} step={step} />
					))}
				</ol>
			</Part>
		</>
	);
}

/** One step: the agent's words, or a tool call folded to its input with what came back inside. */
function Step({ step }: { step: EvalStep }): JSX.Element {
	if (step.kind === "text") {
		return <li className="whitespace-pre-wrap text-sm">{step.text}</li>;
	}
	return (
		<li>
			<details className="rounded border px-2 py-1">
				<summary className="cursor-pointer break-all font-mono">
					<span className="font-medium">{step.name}</span> {shown(step)}
				</summary>
				<pre
					className={cn(
						"mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all",
						step.output === null && "text-muted-foreground",
					)}
				>
					{step.output ?? "(no result)"}
				</pre>
			</details>
		</li>
	);
}

/** A tool call's input as one line: a shell command as written, anything else as its JSON. */
function shown(step: Extract<EvalStep, { kind: "tool" }>): string {
	try {
		const input = JSON.parse(step.input) as { command?: unknown };
		if (typeof input.command === "string") {
			return input.command;
		}
	} catch {
		return step.input;
	}
	return step.input;
}

function Part({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			<h3 className="font-medium text-muted-foreground text-xs uppercase">
				{title}
			</h3>
			{children}
		</div>
	);
}
