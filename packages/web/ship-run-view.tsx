import type { RunState } from "@splates/server/ship";
import { useDisposerEffect, useReactive } from "core/react";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	LoaderCircleIcon,
	SquareIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import {
	answerShipPrompt,
	retryShipStep,
	sendShipStep,
	shipRun,
	shipRunEvents,
	stopShipRun,
} from "./api/ship";
import { Button } from "./components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./components/ui/dialog";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { spanOf } from "./merge-lines";
import { todoAddress } from "./page-address";
import { ShipPromptCard, ShipSignedIn } from "./ship-prompt-card";
import { ShipRecap } from "./ship-recap";
import { markRecapSeen } from "./ship-recap-seen";
import { type ShipRunServer, ShipRunView } from "./ship-run";
import {
	type RunSummary,
	type StepFix,
	type StepPrompt,
	summarize,
	type TargetSummary,
} from "./ship-run-summary";
import { StepRail } from "./ship-step-rail";

/** The server's ship routes, as every view of a run reads them. */
export const SHIP_RUN_SERVER: ShipRunServer = {
	events: shipRunEvents,
	get: shipRun,
	retry: retryShipStep,
	send: sendShipStep,
	stop: stopShipRun,
	answer: answerShipPrompt,
};

/**
 * The Shipping screen for run `id`: the bar and how many targets are done,
 * then the steps in order, each target's card with its state, its latest
 * line and the time it took, live. A failed target offers Send to agent
 * and Retry, and says which task fixes it; a step that asks opens its
 * prompt in place, under its target.
 */
export function ShipRunScreen({
	id,
	server = SHIP_RUN_SERVER,
}: {
	id: string;
	server?: ShipRunServer;
}): JSX.Element {
	const [view] = useState(() => new ShipRunView(id, server));
	useDisposerEffect((disposer) => disposer.use(view.attach()), [view]);
	const {
		run,
		missing,
		live,
		retrying,
		sending,
		answering,
		stopping,
		refused,
	} = useReactive(view, (view) => view.state, ["changed"]);
	if (missing) {
		return (
			<p className="text-muted-foreground text-sm">No ship run is "{id}".</p>
		);
	}
	if (run === null) {
		return <p className="text-muted-foreground text-sm">Reading the run…</p>;
	}
	if (run.status === "done" || run.status === "stopped") {
		markRecapSeen(run.id);
		return (
			<ShipRecap
				run={run}
				onDone={() => {
					location.hash = "#ships";
				}}
			/>
		);
	}
	const summary = summarize(run);
	// Only the first prompt waiting opens, so the user answers one at a time.
	const first = summary.steps
		.flat()
		.flatMap((target) =>
			target.prompts.map((open) => ({ target: target.name, open })),
		)
		.at(0);
	const single = summary.steps.length === 1;
	return (
		<div className="flex flex-col gap-3">
			<Progress
				run={run}
				summary={summary}
				stop={
					(run.status === "running" || run.status === "failed") && (
						<StopRun stopping={stopping} onStop={() => void view.stop()} />
					)
				}
			/>
			{!live && (
				<p className="text-muted-foreground text-xs">
					Reconnecting: this may be behind.
				</p>
			)}
			{summary.steps.map((step, index) => (
				<section
					// A step is the targets in it, which a run keeps.
					key={step.map((each) => each.name).join(" ")}
					aria-label={`Step ${index + 1}`}
					className="flex flex-col gap-2"
				>
					{(!single || step.length > 1) && (
						<h3 className="font-semibold text-sm">
							{!single ? (
								<>
									Step {index + 1}
									{step.length > 1 && (
										<span className="font-normal text-muted-foreground text-xs">
											{" "}
											· {step.length} at the same time
										</span>
									)}
								</>
							) : (
								`${step.length} at the same time`
							)}
						</h3>
					)}
					{step.map((target) => (
						<TargetCard
							key={target.name}
							target={target}
							prompt={first?.target === target.name ? first.open : undefined}
							retrying={target.failed.some((each) =>
								retrying.has(`${target.name}\n${each.id}`),
							)}
							onRetry={() => {
								for (const step of target.failed) {
									void view.retry(target.name, step.id);
								}
							}}
							sending={target.failed.some((each) =>
								sending.has(`${target.name}\n${each.id}`),
							)}
							onSend={() => {
								for (const step of target.failed) {
									void view.send(target.name, step.id);
								}
							}}
							answering={answering}
							onAnswer={(step, prompt, value) =>
								void view.answer(target.name, step, prompt, value)
							}
						/>
					))}
				</section>
			))}
			<RunNotes run={run} />
			{refused !== null && (
				<p className="text-destructive text-sm">{refused}</p>
			)}
		</div>
	);
}

/** Stop, which asks to confirm first: it ends every step under way. */
function StopRun({
	stopping,
	onStop,
}: {
	stopping: boolean;
	onStop: () => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className="shrink-0 rounded-full text-destructive"
				disabled={stopping}
				onClick={() => setOpen(true)}
			>
				<SquareIcon aria-hidden className="size-2.5 fill-current" />
				{stopping ? "Stopping…" : "Stop"}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Stop this ship?</DialogTitle>
						<DialogDescription>
							Every step under way is ended. What already shipped stays out.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Keep going
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								setOpen(false);
								onStop();
							}}
						>
							Stop ship
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/** What agents added to the run, one list, each note tagged with its step. */
function RunNotes({ run }: { run: RunState }): JSX.Element | null {
	if (run.notes.length === 0) {
		return null;
	}
	return (
		<section aria-label="Notes" className="flex flex-col gap-1.5">
			<h3 className="font-semibold text-sm">Notes ({run.notes.length})</h3>
			<ul className="flex flex-col gap-1.5">
				{run.notes.map((note) => (
					<li
						key={`${note.at}\n${note.task}\n${note.text}`}
						className="text-sm"
					>
						<span className="text-muted-foreground text-xs">
							{note.target === undefined
								? "run"
								: `${note.target} · ${note.step}`}{" "}
							· {note.task}
							{" · "}
							{spanOf(Date.now() - note.at)} ago
						</span>
						<p className="whitespace-pre-wrap">
							{note.text}
							{note.link !== undefined && (
								<>
									{" "}
									<NoteLink link={note.link} />
								</>
							)}
						</p>
					</li>
				))}
			</ul>
		</section>
	);
}

/** A note's link: `#2851` opens the task, a URL opens itself. */
function NoteLink({ link }: { link: string }): JSX.Element {
	const task = /^#(\d+)$/.exec(link);
	if (task?.[1] !== undefined) {
		return (
			<a className="underline" href={todoAddress(Number(task[1]))}>
				{link}
			</a>
		);
	}
	return /^https?:\/\//.test(link) ? (
		<a className="underline" href={link} rel="noreferrer" target="_blank">
			{link}
		</a>
	) : (
		<span>{link}</span>
	);
}

/**
 * The card on top, kept in view as the page scrolls: "1 of 5 done", the time
 * the run has taken, and the bar with Stop beside it while the run is under way.
 */
function Progress({
	run,
	summary,
	stop,
}: {
	run: RunState;
	summary: RunSummary;
	stop?: ReactNode;
}): JSX.Element {
	const running = run.status === "running";
	const now = useNow(running);
	const ended = Math.max(
		run.started,
		...run.targets.flatMap((target) =>
			target.steps.flatMap((step) => step.ended ?? []),
		),
	);
	const { done, total, finished, count } = summary;
	const said =
		run.status === "done"
			? "Shipped"
			: run.status === "stopped"
				? `Stopped by you, ${done} of ${total} done`
				: run.status === "failed"
					? `Stopped on a failure, ${done} of ${total} done`
					: `Shipping · ${done} of ${total} done`;
	return (
		<div className="flex flex-col gap-2.5 rounded-xl border bg-card px-3.5 py-3 shadow-xs">
			<p className="flex items-baseline justify-between gap-3 font-semibold text-sm">
				<span>{said}</span>
				<span className="font-normal text-muted-foreground text-xs tabular-nums">
					{spanOf((running ? now : ended) - run.started)}
				</span>
			</p>
			<div className="flex items-center gap-3">
				<div
					role="progressbar"
					aria-label="Steps done"
					aria-valuemin={0}
					aria-valuemax={count}
					aria-valuenow={finished}
					className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
				>
					<div
						// The bar moves with each step, so a run of one target fills as it goes.
						className={cn(
							"h-full rounded-full transition-[width] duration-500",
							run.status === "failed" ? "bg-destructive" : "bg-foreground",
						)}
						style={{ width: `${count === 0 ? 0 : (finished / count) * 100}%` }}
					/>
				</div>
				{stop}
			</div>
		</div>
	);
}

const ICONS = {
	done: (
		<CircleCheckIcon aria-hidden className="size-5 shrink-0 text-green-600" />
	),
	failed: (
		<CircleAlertIcon aria-hidden className="size-5 shrink-0 text-destructive" />
	),
	running: (
		<LoaderCircleIcon
			aria-hidden
			className="size-5 shrink-0 animate-spin text-muted-foreground"
		/>
	),
	waiting: (
		<CircleDashedIcon
			aria-hidden
			className="size-5 shrink-0 text-muted-foreground/60"
		/>
	),
};

/**
 * One target's card: its state, name and time, the line under, its fixes,
 * and Send to agent and Retry once failed.
 */
function TargetCard({
	target,
	prompt,
	retrying,
	onRetry,
	sending,
	onSend,
	answering,
	onAnswer,
}: {
	target: TargetSummary;
	/** The one prompt open on the page, when it is this target's. */
	prompt: StepPrompt | undefined;
	retrying: boolean;
	onRetry: () => void;
	sending: boolean;
	onSend: () => void;
	answering: ReadonlySet<string>;
	onAnswer: (step: string, prompt: string, value: unknown) => void;
}): JSX.Element {
	return (
		<article
			aria-label={target.name}
			data-status={target.status}
			className={cn(
				"flex gap-2.5 rounded-lg border bg-card px-3.5 py-3",
				target.status === "failed"
					? "border-destructive/60"
					: target.asking
						? "border-foreground/70"
						: "border-border",
			)}
		>
			{ICONS[target.status]}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-baseline gap-2">
					<span className="min-w-0 flex-1 truncate font-semibold text-sm">
						{target.name}
					</span>
					<TargetTime target={target} />
				</div>
				{target.status !== "running" ||
				target.steps.length < 2 ||
				target.asking ? (
					<p
						className={cn(
							"break-words text-xs",
							target.asking ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{target.line}
					</p>
				) : null}
				{target.steps.length > 1 && <StepRail steps={target.steps} />}
				{target.signedIn.map((each) => (
					<ShipSignedIn key={each.step} url={each.url} />
				))}
				{prompt !== undefined && (
					<ShipPromptCard
						key={`${prompt.step}\n${prompt.id}`}
						open={prompt}
						answering={answering.has(
							`${target.name}\n${prompt.step}\n${prompt.id}`,
						)}
						onAnswer={(value) => onAnswer(prompt.step, prompt.id, value)}
					/>
				)}
				{target.fixes.map((fix) => (
					<FixLine
						key={`${fix.step}\n${fix.task}`}
						fix={fix}
						failed={target.failed.some((step) => step.id === fix.step)}
					/>
				))}
				{target.status === "failed" && (
					<div className="flex gap-2 pt-1.5">
						{!fixing(target) && (
							<Button
								variant="outline"
								size="sm"
								disabled={sending}
								onClick={onSend}
							>
								{sending ? "Sending…" : "Send to agent"}
							</Button>
						)}
						<Button
							variant="outline"
							size="sm"
							disabled={retrying}
							onClick={onRetry}
						>
							{retrying ? "Retrying…" : "Retry"}
						</Button>
					</div>
				)}
			</div>
		</article>
	);
}

/** Whether an agent is at work on each failed step of `target`. */
function fixing(target: TargetSummary): boolean {
	return target.failed.every((step) =>
		target.fixes.some((fix) => fix.step === step.id && fix.ended === undefined),
	);
}

/** What became of a step sent to an agent, its task linked while open. */
function FixLine({
	fix,
	failed,
}: {
	fix: StepFix;
	/** The step is failed now, the fix's retry refused or failed again. */
	failed: boolean;
}): JSX.Element {
	const task = (
		<a className="underline" href={todoAddress(fix.task)}>
			#{fix.task}
		</a>
	);
	return (
		<p className="text-muted-foreground text-xs">
			{fix.ended === undefined ? (
				<>
					An agent is fixing {fix.step} in {task}: the ship retries it once the
					fix merges.
				</>
			) : fix.ended === "merged" ? (
				<>
					{fix.step} was fixed in #{fix.task}
					{failed ? ", and failed again." : " and retried."}
				</>
			) : (
				<>
					The fix for {fix.step}, #{fix.task}, was removed without merging.
				</>
			)}
		</p>
	);
}

/** How long a target has taken, ticking while it runs. */
function TargetTime({ target }: { target: TargetSummary }): JSX.Element | null {
	const now = useNow(target.status === "running");
	if (target.started === undefined) {
		return null;
	}
	return (
		<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
			{spanOf((target.ended ?? now) - target.started)}
		</span>
	);
}
