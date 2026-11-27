import type { RunState } from "@splates/server/ship";
import { Scroll } from "core/browser";
import { useDisposerEffect, useReactive } from "core/react";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	LoaderCircleIcon,
	SquareIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { type JSX, useId, useRef, useState } from "react";
import {
	answerShipPrompt,
	autoApproveShipRun,
	retryShipStep,
	sendShipStep,
	sendShipTarget,
	shipRun,
	shipRunEvents,
	stopShipRun,
	stopShipTarget,
	superviseShipRun,
} from "./api/ship";
import { cn } from "./lib/utils";
import { todoAddress } from "./page-address";
import { ShipAutoApprove } from "./ship-auto-approve";
import { FixLine, ShipFailureCard } from "./ship-failure-card";
import { ShipHeading } from "./ship-heading";
import { ShipPromptCard, ShipSignedIn } from "./ship-prompt-card";
import { ShipRecap } from "./ship-recap";
import { markRecapSeen } from "./ship-recap-seen";
import { type ShipRunServer, ShipRunView } from "./ship-run";
import { ShipRunProgress } from "./ship-run-progress";
import { summarize, type TargetSummary } from "./ship-run-summary";
import { ShipRunSupervise } from "./ship-run-supervise";
import { RunNotes, SpawnedStrip } from "./ship-spawned";
import type { SpawnedWork } from "./ship-spawned-work";
import { StepRail } from "./ship-step-rail";
import { StopRun, StopTarget } from "./ship-stop";
import { targetPreview } from "./ship-target-preview";
import { TargetTime } from "./ship-target-time";

/** The server's ship routes, as every view of a run reads them. */
export const SHIP_RUN_SERVER: ShipRunServer = {
	events: shipRunEvents,
	get: shipRun,
	retry: retryShipStep,
	send: sendShipStep,
	sendTarget: sendShipTarget,
	stop: stopShipRun,
	stopTarget: stopShipTarget,
	answer: answerShipPrompt,
	supervise: superviseShipRun,
	autoApprove: autoApproveShipRun,
};

/**
 * The Shipping screen for run `id`, live: the bar, what needs the user, then
 * each target's card in order. What needs the user sits under the bar, every
 * failed target first, with Send to agent, Retry and the task fixing it, then
 * every step asking for an answer, each card headed by its target.
 */
export function ShipRunScreen({
	id,
	server = SHIP_RUN_SERVER,
	spawned = NOTHING_SPAWNED,
	agents,
}: {
	id: string;
	agents?: ReactNode;
	server?: ShipRunServer;
	/** The tasks and conversations `run` spawned, where each stands now. */
	spawned?: (run: RunState) => SpawnedWork[];
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
		stoppingTargets,
		supervising,
		approving,
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
				sending={sending}
				refused={refused}
				onSend={(target, slow) => void view.sendTarget(target, slow)}
				onDone={() => {
					location.hash = "#ships";
				}}
			/>
		);
	}
	const summary = summarize(run);
	const all = summary.steps.flat();
	const prompts = all.flatMap((target) =>
		target.prompts.map((open) => ({ target: target.name, open })),
	);
	const broken = all.filter((each) => each.status === "failed");
	const work = spawned(run);
	const single = summary.steps.length === 1;
	const failed = run.status === "failed";
	const targets =
		run.targets.length === 1 ? "1 target" : `${run.targets.length} targets`;
	return (
		<div className="flex flex-col gap-6">
			<ShipHeading
				icon={failed ? ICONS.failed : ICONS.running}
				title={failed ? "Stopped on a failure" : `Shipping ${targets}`}
				line={
					failed
						? broken.every((target) => agentOf(work, target) !== undefined)
							? "An agent is fixing it: the ship retries the step once the fix merges."
							: "Retry the step or send it to an agent."
						: prompts.length > 0
							? "A step asks for an answer below."
							: "Each step shows here as it runs."
				}
			/>
			{agents}
			<div className="flex flex-col gap-3">
				<ShipRunProgress
					run={run}
					summary={summary}
					stop={
						(run.status === "running" || run.status === "failed") && (
							<StopRun stopping={stopping} onStop={() => void view.stop()} />
						)
					}
				/>
				<ShipRunSupervise
					supervise={run.supervise}
					disabled={supervising}
					onFixes={(fixes) => void view.supervise(fixes)}
				/>
				<ShipAutoApprove
					on={run.autoApprove === true}
					disabled={approving}
					onOn={(on) => void view.autoApprove(on)}
				/>
			</div>
			{broken.map((target) => (
				<ShipFailureCard
					key={target.name}
					target={target}
					retrying={target.failed.some((each) =>
						retrying.has(`${target.name}\n${each.id}`),
					)}
					onRetry={() => view.retryFailed(target)}
					sending={target.failed.some((each) =>
						sending.has(`${target.name}\n${each.id}`),
					)}
					onSend={() => view.sendFailed(target)}
					supervise={run.supervise}
					supervising={supervising}
					onSupervise={(fixes) => void view.supervise(fixes)}
					agent={agentOf(work, target)}
				/>
			))}
			{prompts.map(({ target, open }) => (
				<ShipPromptCard
					key={`${target}\n${open.step}\n${open.id}`}
					target={target}
					open={open}
					answering={answering.has(`${target}\n${open.step}\n${open.id}`)}
					onAnswer={(value) =>
						void view.answer(target, open.step, open.id, value)
					}
				/>
			))}
			{!live && (
				<p className="text-muted-foreground text-xs">
					Reconnecting: this may be behind.
				</p>
			)}
			{summary.steps.map((step, index) => (
				<section
					// A step is the targets in it, which a run keeps.
					key={step.map((each) => each.name).join(" ")}
					aria-label={`Group ${index + 1}`}
					className="flex flex-col gap-2.5"
				>
					{(!single || step.length > 1) && (
						<h3 className="font-semibold text-sm">
							{!single ? (
								<>
									Group {index + 1}
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
							runId={run.id}
							target={target}
							stopping={stoppingTargets.has(target.name)}
							onStop={
								run.status === "running" || run.status === "failed"
									? () => void view.stopTarget(target.name)
									: undefined
							}
						/>
					))}
				</section>
			))}
			<SpawnedStrip work={work} />
			<RunNotes notes={run.notes} />
			{refused !== null && (
				<p className="text-destructive text-sm">{refused}</p>
			)}
		</div>
	);
}

/** No spawned work, where the page knows of no board or conversations. */
const NOTHING_SPAWNED = (): SpawnedWork[] => [];

/**
 * Where to watch the agent fixing a failed step of `target`: its
 * conversation once one took the fix, else the fix's board task.
 */
function agentOf(
	work: SpawnedWork[],
	target: TargetSummary,
): string | undefined {
	const open = target.fixes.find(
		(fix) =>
			fix.ended === undefined &&
			target.failed.some((step) => step.id === fix.step),
	);
	if (open === undefined) {
		return undefined;
	}
	const talk = work.find(
		(each) => each.kind === "fix" && each.todo === open.task,
	)?.conversation;
	return talk === undefined ? todoAddress(open.task) : `#conversations/${talk}`;
}

const ICONS = {
	done: (
		<CircleCheckIcon aria-hidden className="size-5 shrink-0 text-success" />
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
	stopped: (
		<SquareIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
	),
	waiting: (
		<CircleDashedIcon
			aria-hidden
			className="size-5 shrink-0 text-muted-foreground/60"
		/>
	),
};

/**
 * One target's card: its state, name and time, the line under and its fixes.
 * A failed target's fixes, Send to agent and Retry open up top instead.
 */
function TargetCard({
	runId,
	target,
	stopping = false,
	onStop,
}: {
	runId: string;
	target: TargetSummary;
	stopping?: boolean;
	/** Stops this target alone; absent once the run is over. */
	onStop?: () => void;
}): JSX.Element {
	const done = target.status === "done";
	const [disclosure, setDisclosure] = useState({ done, expanded: false });
	// A target completing folds once; reopening it after that is the user's choice.
	if (disclosure.done !== done) {
		setDisclosure({ done, expanded: false });
	}
	const expanded = disclosure.done === done && disclosure.expanded;
	const preview = targetPreview(target.steps);
	const shown = expanded ? target.steps : preview.steps;
	const details = useId();
	const signedIn = target.signedIn;
	const fixes = target.status === "failed" ? [] : target.fixes;
	// Notes sit under their step in the rail; those whose step it does not draw sit below it.
	const railed = new Set(
		target.steps.length > 1 || expanded ? shown.map((each) => each.id) : [],
	);
	const card = useRef<HTMLElement>(null);
	const toggle = () => {
		setDisclosure({ done, expanded: !expanded });
		Scroll.reveal(
			() =>
				expanded
					? card.current
					: (card.current?.querySelector<HTMLElement>(
							'[data-status="running"], [data-status="checking"], [data-status="waiting"], [data-status="failed"]',
						) ?? card.current),
			{ block: "start" },
		);
	};
	return (
		<article
			ref={card}
			aria-label={target.name}
			data-status={target.status}
			className={cn(
				"flex gap-3 rounded-lg border bg-card px-4 py-3.5",
				!expanded && "max-h-[min(360px,50dvh)] overflow-hidden",
				target.asking ? "border-foreground/70" : "border-border",
			)}
		>
			{ICONS[target.status]}
			<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
				<div className="flex shrink-0 items-baseline gap-2">
					<button
						type="button"
						aria-expanded={expanded}
						aria-controls={details}
						onClick={toggle}
						className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-semibold text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="min-w-0 flex-1 truncate">{target.name}</span>
						{expanded ? (
							<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
						) : (
							<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
						)}
					</button>
					<TargetTime target={target} />
					{onStop !== undefined &&
						target.status !== "done" &&
						target.status !== "stopped" && (
							<StopTarget
								name={target.name}
								stopping={stopping}
								onStop={onStop}
							/>
						)}
				</div>
				{target.status !== "running" ||
				target.steps.length < 2 ||
				target.asking ? (
					<p
						className={cn(
							"shrink-0 break-words text-xs",
							!expanded && "line-clamp-2",
							target.asking ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{target.line}
					</p>
				) : null}
				{!expanded && target.steps.length > 1 && preview.completed > 0 && (
					<button
						type="button"
						onClick={toggle}
						aria-controls={details}
						aria-expanded={false}
						className="-ml-8 my-2 flex shrink-0 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
					>
						<ChevronRightIcon className="size-3" />
						{preview.completed} completed steps
					</button>
				)}
				<div
					id={details}
					className={cn("-ml-8 min-h-0 pl-8", !expanded && "overflow-hidden")}
					hidden={done && !expanded}
				>
					{(target.steps.length > 1 || expanded) && (
						<div className="-ml-8">
							<StepRail
								run={runId}
								target={target.name}
								steps={shown}
								notes={(step) => (
									<>
										{signedIn
											.filter((each) => each.step === step)
											.map((each) => (
												<ShipSignedIn key={each.step} url={each.url} />
											))}
										{fixes
											.filter((fix) => fix.step === step)
											.map((fix) => (
												<FixLine
													key={`${fix.step}\n${fix.task}`}
													fix={fix}
													failed={false}
												/>
											))}
									</>
								)}
							/>
						</div>
					)}
					{signedIn
						.filter((each) => !railed.has(each.step))
						.map((each) => (
							<ShipSignedIn key={each.step} url={each.url} />
						))}
					{fixes
						.filter((fix) => !railed.has(fix.step))
						.map((fix) => (
							<FixLine
								key={`${fix.step}\n${fix.task}`}
								fix={fix}
								failed={false}
							/>
						))}
				</div>
				{!expanded && !done && preview.later > 0 && (
					<button
						type="button"
						onClick={toggle}
						aria-controls={details}
						aria-expanded={false}
						className="-ml-8 flex shrink-0 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
					>
						<ChevronRightIcon className="size-3" />
						{preview.later} more steps
					</button>
				)}
				{expanded && (
					<button
						type="button"
						onClick={toggle}
						aria-controls={details}
						aria-expanded
						className="-ml-8 flex shrink-0 items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
					>
						<ChevronDownIcon className="size-3" />
						Collapse entry
					</button>
				)}
			</div>
		</article>
	);
}
