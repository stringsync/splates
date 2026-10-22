import type {
	EvalCheck,
	EvalDetail,
	EvalEvent,
} from "@stringsync/splates-server/evals/browser";
import { ArrowLeftIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { evalRun } from "./api";
import { ReadingNow } from "./countdown";
import { ImproveMenu, improvable } from "./eval-improve";
import { targetLabel } from "./eval-report";
import { StatusChip, spent } from "./eval-status";
import { EvalReply } from "./evals-reply";

/**
 * One run opened to find why it went as it did: what it asked, how it
 * stopped, and each check with the evidence it read, laid out for its kind:
 * the event timeline for `count` and `before`, the values for `state`, the
 * reply drawn as cards for `reply`, and the reason for `uncovered`.
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
	const failing = run.checks.filter((check) => check.status !== "pass");
	return (
		<>
			<header className="flex flex-col gap-1">
				<span className="flex flex-wrap items-center gap-2">
					<StatusChip status={run.status} unjudged={run.unjudged} />
					<h2 className="font-medium">{run.probe}</h2>
					<span className="text-muted-foreground text-sm">
						on {targetLabel(run.target)}
						{run.repetition > 0 && `, repetition ${run.repetition + 1}`}
					</span>
				</span>
				<p className="text-muted-foreground text-xs">
					{run.aspect} · {run.requirement} · {spent(run)}
				</p>
				<p className="text-sm">{run.requirementText}</p>
				{improvable(run.status) && <ImproveMenu run={run} className="mt-1" />}
			</header>
			{run.termination !== "stop" && (
				<p
					role="alert"
					className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
				>
					The run stopped early: <b>{run.termination}</b>
					{run.detail !== null && <>: {run.detail}</>}
				</p>
			)}
			<Part title="Asked">
				<pre className="whitespace-pre-wrap text-sm">{run.input}</pre>
			</Part>
			<Part
				title={`Checks: ${run.checks.length - failing.length} of ${run.checks.length} pass${run.unjudged > 0 ? `, ${run.unjudged} unjudged` : ""}`}
			>
				<ul className="flex flex-col gap-3">
					{[
						...failing,
						...run.checks.filter((check) => check.status === "pass"),
					].map((check) => (
						<li key={check.id}>
							<Check check={check} run={run} />
						</li>
					))}
				</ul>
			</Part>
			<Part title="Reply">
				{run.reply === null ? (
					<p className="text-muted-foreground text-sm">The run has no reply.</p>
				) : (
					<EvalReply text={run.reply} />
				)}
			</Part>
			<Part title={`Events: ${run.events.length}`}>
				<Timeline events={run.events} marked={[]} />
			</Part>
			<Part title="State">
				<Json value={run.state} />
			</Part>
			<Part title="Run it again">
				<pre className="overflow-x-auto text-xs">
					{run.reproduction.map(quote).join(" ")}
				</pre>
				<p className="text-muted-foreground text-xs">
					Trace and logs: <code>{run.logs}</code>
				</p>
			</Part>
		</>
	);
}

/** One check, opened when it failed: its spec and the evidence its kind reads. */
function Check({
	check,
	run,
}: {
	check: EvalCheck;
	run: EvalDetail;
}): JSX.Element {
	return (
		<details
			open={check.status !== "pass"}
			className="rounded-lg border bg-card"
		>
			<summary className="flex cursor-pointer items-center gap-2 p-2 text-sm">
				<StatusChip status={check.status} />
				<span className="font-medium">{check.id}</span>
				<span className="text-muted-foreground text-xs">
					{check.assertion.kind}
				</span>
			</summary>
			<div className="flex flex-col gap-3 border-t p-3">
				<CheckBody check={check} run={run} />
			</div>
		</details>
	);
}

function CheckBody({
	check,
	run,
}: {
	check: EvalCheck;
	run: EvalDetail;
}): ReactNode {
	const { assertion } = check;
	switch (assertion.kind) {
		case "count":
			return (
				<>
					<Said>
						Expects {range(check.expected)} of <Match value={assertion.match} />
						; found <b>{String(check.actual)}</b>.
					</Said>
					<Timeline events={run.events} marked={check.evidence} />
				</>
			);
		case "before":
			return (
				<>
					<Said>
						Expects every <Match value={assertion.first} /> before every{" "}
						<Match value={assertion.second} />, both at least once. Found at
						event positions <Json value={check.actual} inline />.
					</Said>
					<Timeline events={run.events} marked={check.evidence} />
				</>
			);
		case "state":
			return (
				<>
					<Said>
						Expects state <code>{String(assertion.key)}</code> to equal:
					</Said>
					<Versus expected={check.expected} actual={check.actual} />
				</>
			);
		case "reply":
			return (
				<>
					<Said>
						Expects a <b>{String(assertion.type)}</b> part of the reply whose{" "}
						<code>
							{((assertion.field as string[]) ?? []).join(".") || "(whole)"}
						</code>{" "}
						equals the expected value; the actual values are each such part
						found.
					</Said>
					<Versus expected={check.expected} actual={check.actual} />
					{run.reply !== null && (
						<details className="text-xs">
							<summary className="cursor-pointer text-muted-foreground">
								The reply as written
							</summary>
							<pre className="mt-1 whitespace-pre-wrap">{run.reply}</pre>
						</details>
					)}
				</>
			);
		case "uncovered":
			return (
				<Said>
					Not judged by design:{" "}
					<b>{String(assertion.reason).replace(/\.$/, "")}</b>.
				</Said>
			);
		case "runner":
			return (
				<Said>
					The run did not see its <b>{String(check.expected)}</b> channel whole,
					so checks that read it cannot pass. Saw whole:{" "}
					{run.complete.join(", ") || "nothing"}.
				</Said>
			);
		default:
			return <Versus expected={check.expected} actual={check.actual} />;
	}
}

/** Every event the run saw, in order, those a check rests on marked. */
function Timeline({
	events,
	marked,
}: {
	events: EvalEvent[];
	marked: string[];
}): JSX.Element {
	if (events.length === 0) {
		return <p className="text-muted-foreground text-sm">No events.</p>;
	}
	return (
		<ol className="flex flex-col font-mono text-xs">
			{events.map((event, at) => (
				<li
					key={event.id}
					className={cn(
						"flex gap-2 rounded px-1 py-0.5",
						marked.includes(event.id) && "bg-primary/10 font-medium",
					)}
				>
					<span className="w-6 shrink-0 text-right text-muted-foreground">
						{at}
					</span>
					<span className="w-28 shrink-0 whitespace-nowrap text-muted-foreground">
						{event.actor} {event.kind}
					</span>
					<span className="min-w-0 break-all">
						{[event.name, ...event.args].map(quote).join(" ")}
						{event.exitCode !== undefined && event.exitCode !== 0 && (
							<span className="text-destructive"> → exit {event.exitCode}</span>
						)}
					</span>
				</li>
			))}
		</ol>
	);
}

/** Expected beside actual, as JSON. */
function Versus({
	expected,
	actual,
}: {
	expected: unknown;
	actual: unknown;
}): JSX.Element {
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			<div>
				<div className="text-muted-foreground text-xs">Expected</div>
				<Json value={expected} />
			</div>
			<div>
				<div className="text-muted-foreground text-xs">Actual</div>
				<Json value={actual} />
			</div>
		</div>
	);
}

function Json({
	value,
	inline = false,
}: {
	value: unknown;
	inline?: boolean;
}): JSX.Element {
	return inline ? (
		<code>{JSON.stringify(value)}</code>
	) : (
		<pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

/** An event a check looks for, as the command it would be. */
function Match({ value }: { value: unknown }): JSX.Element {
	const match = value as {
		actor: string;
		kind: string;
		name: string;
		args?: string[];
		exitCode?: number;
	};
	return (
		<code>
			{match.actor} {match.kind} {[match.name, ...(match.args ?? [])].join(" ")}
			{match.exitCode !== undefined && ` (exit ${match.exitCode})`}
		</code>
	);
}

function range(expected: unknown): string {
	const { min, max } = expected as { min: number; max: number | null };
	return max === null
		? `at least ${min}`
		: min === max
			? `exactly ${min}`
			: `${min} to ${max}`;
}

function Said({ children }: { children: ReactNode }): JSX.Element {
	return <p className="text-sm">{children}</p>;
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

function quote(word: string): string {
	return /^[\w@%+=:,./-]+$/.test(word)
		? word
		: `'${word.replaceAll("'", "'\\''")}'`;
}
