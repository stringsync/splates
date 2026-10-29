import type {
	ShipBump,
	ShipReviewProgress,
	ShipStep,
} from "@stringsync/splates-server/ship";
import { CHANGED } from "@stringsync/splates-server/ship/browser";
import { useReactive } from "@webappwiz/react";
import { LoaderCircleIcon, ShipIcon } from "lucide-react";
import { type JSX, useEffect, useId, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { askMachineNow } from "./machine";
import { Refusal } from "./refusal";
import type { ShipApproval } from "./ship-approval";
import { ShipBumpSelector } from "./ship-bump-selector";
import { ShipTree } from "./ship-tree";

/**
 * The plan to ship the project `approval` names at its selected bump, drawn by
 * the server as it opens: each project in dependency order, the version it goes
 * to, what it publishes, which packages of those before it it takes, and why it
 * ships or only takes its bump. The person may leave any dependent out, with
 * what only it carries the release to, and add it back. Approve starts the whole cascade on the server,
 * the person's alone, and the bars' ship badge follows it from there; npm still
 * asks the person at each publish.
 */
export function ShipDialog({
	approval,
	onClose,
	onApproved,
}: {
	approval: ShipApproval;
	onClose: () => void;
	/** Called after the ship starts, such as to tell the agent that asked for it. */
	onApproved?: () => void;
}): JSX.Element {
	const project = approval.project;
	const changed = project === CHANGED;
	const { plan, bump, refusal, starting } = useReactive(
		approval,
		(each) => ({
			plan: each.plan,
			bump: each.bump,
			refusal: each.refusal,
			starting: each.starting,
		}),
		["changed"],
	);
	useEffect(() => {
		void approval.draw();
	}, [approval]);
	useEffect(() => {
		if (!plan?.steps.some((step) => step.review?.status === "pending")) {
			return;
		}
		const waiting = new SystemTimer().setTimeout(
			() => void approval.draw(),
			Duration.secs(2),
		);
		return () => waiting.dispose();
	}, [approval, plan]);
	const [confirming, setConfirming] = useState(false);
	const reviews = plan?.steps.filter((step) => step.review !== undefined) ?? [];
	const reviewing = reviews.filter((step) => step.review?.status === "pending");
	const leave = () => {
		if (reviewing.length > 0 && !starting) {
			setConfirming(true);
		} else {
			onClose();
		}
	};
	const blockedId = useId();
	const blocked =
		starting || approval.ready
			? null
			: plan?.steps.some((step) => step.review?.status === "pending")
				? "Approve and ship is waiting for every dependency review to finish."
				: plan?.steps.some((step) => step.review?.status === "failed")
					? "Approve and ship is blocked by a failed dependency review. Retry reviews to continue."
					: null;
	const approve = async () => {
		if (await approval.approve()) {
			onApproved?.();
			askMachineNow();
			onClose();
		}
	};
	return (
		<Dialog open onOpenChange={(next) => !next && leave()}>
			<DialogContent className="inset-0 h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 content-start overflow-y-auto rounded-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90dvh] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
				<DialogHeader>
					<DialogTitle>
						{approval.recovery === undefined
							? "Ship plan for"
							: "Recover ship of"}{" "}
						{changed ? "every changed project" : project}
					</DialogTitle>
					<DialogDescription>
						{approval.recovery !== undefined
							? "Checks the stopped run against npm and reviews the remaining work. Published releases stay published; approval starts a new run."
							: changed
								? "Nothing runs until you approve. Then it publishes each project with commits since its last release, dependencies first, and carries each release through every project that depends on it. npm asks you at each publish."
								: `Nothing runs until you approve. Then it publishes ${project}, then carries the release through every project that depends on it, as a dependency tree. npm asks you at each publish.`}
					</DialogDescription>
				</DialogHeader>
				{approval.recovery === undefined && !changed && (
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="text-sm font-medium">Release type</span>
						<ShipBumpSelector
							label="Release type"
							value={bump}
							onChange={(chosen) => void approval.choose(chosen)}
							disabled={starting}
						/>
					</div>
				)}
				{reviewing.length > 0 && (
					<ReviewStatus reviewing={reviewing} total={reviews.length} />
				)}
				{plan === null && refusal === null && (
					<p className="flex items-center gap-2 text-muted-foreground">
						<LoaderCircleIcon className="size-4 animate-spin" />
						Drawing the plan…
					</p>
				)}
				{plan?.recovery !== undefined && (
					<section
						className="flex flex-col gap-1 text-sm"
						aria-label="Already published"
					>
						<p className="font-medium">Already published, kept as inputs</p>
						{plan.recovery.inputs.map((use) => (
							<p key={use.project}>
								{use.project}:{" "}
								{use.pins.map((pin) => `${pin.name}@${pin.version}`).join(", ")}
							</p>
						))}
						{plan.steps.length === 0 && <p>Nothing remains to recover.</p>}
					</section>
				)}
				{plan !== null && (
					<PlanSteps
						steps={plan.steps}
						everyRelease={changed}
						starting={starting || !approval.ready}
						onChoose={(slug, bump) => approval.chooseDependent(slug, bump)}
						onLeaveOut={
							approval.recovery === undefined && !starting
								? (slug) => void approval.leaveOut(slug)
								: undefined
						}
					/>
				)}
				{plan?.skipped !== undefined && (
					<section
						className="flex flex-col gap-1 text-sm"
						aria-label="Left out"
					>
						<p className="font-medium">
							Left out, with what only they carry the release to
						</p>
						{plan.skipped.map((slug) => (
							<p key={slug} className="flex items-center gap-2">
								<span>{slug}</span>
								<Button
									variant="outline"
									size="sm"
									className="ml-auto"
									disabled={starting}
									aria-label={`Add ${slug} back`}
									onClick={() => void approval.leaveOut(slug, false)}
								>
									Add back
								</Button>
							</p>
						))}
					</section>
				)}
				{(plan?.steps.some((step) => step.review?.status === "failed") ||
					refusal !== null) && (
					<Button variant="outline" onClick={() => void approval.draw(true)}>
						{plan === null ? "Retry plan" : "Retry reviews"}
					</Button>
				)}
				<Refusal refusal={refusal} className="text-sm" />
				{blocked !== null && (
					<p
						id={blockedId}
						role="status"
						className="text-muted-foreground text-sm"
					>
						{blocked}
					</p>
				)}
				<DialogFooter className="flex-row items-center gap-3 max-sm:px-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
					<Button
						variant="outline"
						className="h-11 px-4 text-base sm:h-8 sm:text-sm"
						onClick={leave}
					>
						Cancel
					</Button>
					<Button
						className="h-11 flex-1 text-base sm:h-8 sm:flex-none sm:text-sm"
						disabled={!approval.ready || starting}
						aria-describedby={blocked === null ? undefined : blockedId}
						onClick={() => void approve()}
					>
						{starting ? (
							<LoaderCircleIcon className="animate-spin" />
						) : (
							<ShipIcon />
						)}
						Approve and ship
					</Button>
				</DialogFooter>
			</DialogContent>
			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Leave while agents review?</DialogTitle>
						<DialogDescription>
							{reviewing.length === 1
								? "An agent is still reviewing a dependent's release type."
								: `${reviewing.length} dependents are still waiting on their release type reviews.`}{" "}
							The reviews keep running on the server and their agents are not
							stopped. Reopen the ship plan to see them finish.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="flex-row gap-3">
						<Button
							variant="outline"
							className="h-11 px-4 text-base sm:h-8 sm:text-sm"
							onClick={onClose}
						>
							Leave anyway
						</Button>
						<Button
							className="h-11 flex-1 text-base sm:h-8 sm:flex-none sm:text-sm"
							onClick={() => setConfirming(false)}
						>
							Keep watching
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Dialog>
	);
}

/** One bar for the dependency reviews under way: how far along, which agent, and what it is doing. */
function ReviewStatus({
	reviewing,
	total,
}: {
	reviewing: ShipStep[];
	total: number;
}): JSX.Element {
	const current = reviewing.find((step) => step.review?.progress !== undefined);
	const progress = current?.review?.progress;
	const done = total - reviewing.length;
	return (
		<section
			role="status"
			aria-label="Dependency review"
			className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm"
		>
			<p className="flex items-center gap-2 font-medium">
				<LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
				{`Reviewing dependencies, ${done} of ${total} done`}
			</p>
			{current !== undefined && progress !== undefined ? (
				<p className="break-words text-muted-foreground">
					{`${current.slug}: ${progress.agent} · ${progress.activity} · ${elapsed(progress)}`}
				</p>
			) : (
				<p className="text-muted-foreground">Waiting for an agent to start…</p>
			)}
		</section>
	);
}

/** How long a review has run, as `1m 05s`. */
function elapsed(progress: ShipReviewProgress): string {
	const secs = Math.max(
		0,
		Math.floor((Date.now() - Date.parse(progress.since)) / 1000),
	);
	return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

/** The plan as a tree, each project beneath its first dependency in the plan. */
function PlanSteps({
	steps,
	everyRelease,
	starting,
	onChoose,
	onLeaveOut,
}: {
	steps: ShipStep[];
	/** Whether each project that ships picks its own release type, with no one release type above the plan. */
	everyRelease: boolean;
	starting: boolean;
	onChoose: (slug: string, bump: ShipBump) => void;
	/** Leaves a dependent out of the ship; absent when none may be. */
	onLeaveOut?: (slug: string) => void;
}): JSX.Element {
	return (
		<ShipTree
			label="Ship plan"
			items={steps}
			slugOf={(step) => step.slug}
			dependenciesOf={(step) => step.takes.map((use) => use.project)}
			render={(step) => (
				<PlanProject
					step={step}
					choosable={
						everyRelease || step.takes.length > 0 || step.review !== undefined
					}
					starting={starting}
					onChoose={onChoose}
					onLeaveOut={step.takes.length > 0 ? onLeaveOut : undefined}
				/>
			)}
			className="max-h-[55vh] overflow-y-auto pr-1"
		/>
	);
}

function PlanProject({
	step,
	choosable,
	starting,
	onChoose,
	onLeaveOut,
}: {
	step: ShipStep;
	/** Whether the person picks this project's release type here. */
	choosable: boolean;
	starting: boolean;
	onChoose: (slug: string, bump: ShipBump) => void;
	/** Leaves this dependent out of the ship; absent when it may not be. */
	onLeaveOut?: (slug: string) => void;
}): JSX.Element {
	return (
		<div
			className={cn(
				"flex flex-col gap-1 rounded-lg border bg-card p-3",
				step.takes.length === 0 && "border-primary/25 bg-primary/5",
			)}
		>
			<p className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<ShipIcon className="size-3.5 text-muted-foreground" />
				<span className="font-medium">{step.slug}</span>
				<span
					className={cn(
						"rounded-full px-1.5 text-[11px]",
						step.action === "ship"
							? "bg-primary/10 text-primary"
							: "bg-muted text-muted-foreground",
					)}
				>
					{step.action === "ship" ? "ships" : "takes its bump"}
				</span>
				{step.takes.length > 1 && (
					<span className="text-muted-foreground text-[11px]">
						shared dependent
					</span>
				)}
				<span className="ml-auto text-muted-foreground text-xs tabular-nums">
					{versionOf(step)}
				</span>
			</p>
			{step.publishes.length > 0 && (
				<p className="pl-5.5 text-muted-foreground text-xs">
					Publishes {step.publishes.join(", ")}
				</p>
			)}
			{step.takes.length > 0 && (
				<p className="pl-5.5 text-muted-foreground text-xs">
					Takes{" "}
					{step.takes
						.map(
							(use) =>
								`${use.pins.map((pin) => pin.name).join(", ")} from ${use.project}`,
						)
						.join("; ")}
				</p>
			)}
			<p className="pl-5.5 text-muted-foreground text-xs">{whyOf(step)}</p>
			{step.review !== undefined && (
				<p role="status" className="flex items-center gap-2 text-sm">
					{step.review.status === "pending" && (
						<LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
					)}
					{step.review.status === "pending"
						? step.review.progress === undefined
							? "Waiting for an agent to review dependencies…"
							: `${step.review.progress.agent} is reviewing dependencies to propose the release type…`
						: step.review.status === "failed"
							? `Review failed: ${step.review.reasons}`
							: `${step.review.proposed === null ? "Review" : `Proposed ${step.review.proposed}`}: ${step.review.reasons}`}
				</p>
			)}
			{choosable && step.bump !== null && (
				<ShipBumpSelector
					label={`Release type for ${step.slug}`}
					value={step.bump}
					disabled={starting || step.review?.status === "pending"}
					onChange={(bump) => onChoose(step.slug, bump)}
				/>
			)}
			{onLeaveOut !== undefined && (
				<Button
					variant="outline"
					className="mt-1 h-11 w-full text-base sm:h-8 sm:text-sm"
					aria-label={`Leave ${step.slug} out`}
					onClick={() => onLeaveOut(step.slug)}
				>
					Leave out
				</Button>
			)}
		</div>
	);
}

/** The version a step goes to from where it is, or where it stays for a bump. */
export function versionOf(step: ShipStep): string {
	if (step.to === null) {
		return step.from ?? "";
	}
	return `${step.from ?? "?"} → ${step.to}`;
}

/** Why a step ships or only takes its bump, as a sentence. */
function whyOf(step: ShipStep): string {
	if (step.takes.length === 0) {
		return step.why === "the project shipped"
			? "The project shipped."
			: `${step.why.charAt(0).toUpperCase()}${step.why.slice(1)}.`;
	}
	return step.action === "ship"
		? `Ships too, since ${step.why}.`
		: `Only takes its bump: ${step.why}.`;
}
