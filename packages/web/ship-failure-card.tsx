import type { StepState, Supervision } from "@splates/server/ship";
import { CircleAlertIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import type { JSX } from "react";
import { Button, buttonVariants } from "./components/ui/button";
import { todoAddress } from "./page-address";
import { SUPERVISE_FIXES } from "./ship-flow";
import type { StepFix, TargetSummary } from "./ship-run-summary";

/**
 * A failed target, opened under the ship's progress bar where a step's prompt
 * would: why it failed, what became of any fix and the run's supervisor, and
 * Send to agent (View agent while one is fixing it) and Retry, with + 1 fix
 * once the supervisor's fixes are spent, or Supervise when it has none.
 * Headed by the target's name, so several at once each say whose they are.
 */
export function ShipFailureCard({
	target,
	retrying,
	onRetry,
	sending,
	onSend,
	supervise,
	supervising = false,
	onSupervise = () => {},
	agent,
}: {
	target: TargetSummary;
	retrying: boolean;
	onRetry: () => void;
	sending: boolean;
	onSend: () => void;
	/** The run's supervisor, absent when the run is unsupervised. */
	supervise?: Supervision;
	supervising?: boolean;
	/** Gives the supervisor that many more fixes. */
	onSupervise?: (fixes: number) => void;
	/** Where to watch the agent fixing it: its conversation, or its task. */
	agent?: string;
}): JSX.Element {
	const busy = fixing(target);
	const spent = supervise !== undefined && supervise.spent >= supervise.budget;
	const handedBack = target.failed.some((step) => step.handedBack === true);
	const steps = target.failed.map((step) => step.does).join(", ");
	return (
		<section
			aria-label={`${target.name} failed`}
			className="flex flex-col gap-2 rounded-lg border bg-card p-3"
		>
			<div className="flex items-baseline gap-2">
				<span className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold text-sm">
					<CircleAlertIcon
						aria-hidden
						className="size-4 shrink-0 text-destructive"
					/>
					<span className="truncate">{target.name}</span>
				</span>
				<span className="shrink-0 rounded border border-foreground/50 px-1.5 text-[11px]">
					{busy ? "agent fixing" : "needs you"}
				</span>
			</div>
			<span className="-mt-1.5 font-semibold text-destructive/80 text-xs uppercase">
				{steps} failed
			</span>
			<p className="break-words text-sm">{target.line}</p>
			{target.fixes.map((fix) => (
				<FixLine
					key={`${fix.step}\n${fix.task}`}
					fix={fix}
					failed={target.failed.some((step) => step.id === fix.step)}
				/>
			))}
			{supervise !== undefined && (
				<SupervisorLine
					supervise={supervise}
					busy={busy}
					handedBack={handedBack}
					failed={target.failed}
				/>
			)}
			<div className="flex flex-wrap gap-2 pt-1">
				{busy && agent !== undefined && (
					<a
						href={agent}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						View agent
					</a>
				)}
				{!busy && (
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
				{!busy && spent && !handedBack && (
					<Button
						variant="outline"
						size="sm"
						disabled={supervising}
						onClick={() => onSupervise(1)}
					>
						<PlusIcon data-icon="inline-start" />1 fix
					</Button>
				)}
				{supervise === undefined && (
					<Button
						variant="outline"
						size="sm"
						disabled={supervising}
						onClick={() => onSupervise(SUPERVISE_FIXES)}
					>
						<ShieldCheckIcon data-icon="inline-start" />
						Supervise · {SUPERVISE_FIXES} fixes
					</Button>
				)}
			</div>
		</section>
	);
}

/**
 * What the run's supervisor is doing about the target: which of its fixes
 * is at work and the ones before it, or why the failure waits for the user.
 */
function SupervisorLine({
	supervise,
	busy,
	handedBack,
	failed,
}: {
	supervise: Supervision;
	busy: boolean;
	handedBack: boolean;
	failed: StepState[];
}): JSX.Element {
	const earlier = failed.flatMap((step) => step.earlier ?? []);
	return (
		<p className="flex items-start gap-1.5 text-muted-foreground text-xs">
			<ShieldCheckIcon aria-hidden className="mt-px size-3.5 shrink-0" />
			<span>
				{busy ? (
					<>
						Supervised · fix {supervise.spent} of {supervise.budget}.
						{earlier.length > 0 && (
							<>
								{" "}
								Earlier:{" "}
								{earlier.map((fix, index) => (
									<span key={fix.task}>
										{index > 0 && ", "}
										<a className="underline" href={todoAddress(fix.task)}>
											#{fix.task}
										</a>
									</span>
								))}
								.
							</>
						)}
					</>
				) : handedBack ? (
					"The agent gave up on this step, so the supervisor leaves it to you."
				) : supervise.spent >= supervise.budget ? (
					`The supervisor used all ${supervise.budget} ${supervise.budget === 1 ? "fix" : "fixes"}, so this one waits for you.`
				) : (
					`Supervised · ${supervise.budget - supervise.spent} of ${supervise.budget} fixes left.`
				)}
			</span>
		</p>
	);
}

/** Whether an agent is at work on each failed step of `target`. */
function fixing(target: TargetSummary): boolean {
	return target.failed.every((step) =>
		target.fixes.some((fix) => fix.step === step.id && fix.ended === undefined),
	);
}

/** What became of a step sent to an agent, its task linked while open. */
export function FixLine({
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
