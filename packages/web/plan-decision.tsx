import {
	planFields,
	planHasInvasiveTag,
	planHasOneWayTag,
	planTags,
} from "@splates/server/plans/browser";
import {
	CheckCheckIcon,
	CheckIcon,
	LockIcon,
	PencilIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { type JSX, type KeyboardEvent, type ReactNode, useId } from "react";
import { Card } from "#web/components/ui/card.tsx";
import { cn } from "#web/lib/utils.ts";
import { toggleDecision } from "./card-send-policy";

/** Approve, approve with a review before it merges, or request changes. */
export type PlanChoice = "approve" | "review" | "revise";

/** Why a plan's tags require a merge review before landing, or null when optional. */
export type PlanReviewRequired = "one-way" | "invasive" | null;

/** Tag-derived defaults for a plan's post-approval options. */
export interface PlanApprovalDefaults {
	/** Why review before merge is forced by a plan tag, or null when optional. */
	reviewRequired: PlanReviewRequired;
	/** Default Review before merge state (true when required by tags). */
	review: boolean;
	/** Default Archive after merge state (true for small, reversible, self-contained plans with no watch-out tags). */
	archive: boolean;
}

/**
 * A plan's decision, asked as its own question set apart from the others,
 * so approval is a choice the person makes rather than what Send does. Send
 * stays an ordinary Send and carries the choice picked here.
 */
export function PlanDecision({
	choice,
	onChoice,
	review = false,
	onReview,
	archive = false,
	onArchive,
	reviewRequired = null,
	unanswered,
	roomy = false,
	leading = false,
	flat = false,
	stop,
	onNext,
}: {
	choice: PlanChoice | null;
	onChoice: (choice: PlanChoice | null) => void;
	/** Whether the approved plan should pause at Ready to merge before landing. */
	review?: boolean;
	onReview?: (review: boolean) => void;
	/** Whether the conversation should archive automatically after an uninterrupted merge. */
	archive?: boolean;
	onArchive?: (archive: boolean) => void;
	/** Whether One-way or Invasive tags force a merge review before landing. */
	reviewRequired?: PlanReviewRequired;
	/** Whether a question is still unanswered, which holds approval back. */
	unanswered: boolean;
	/** Whether it sits on the phone's sheet, with room for larger targets. */
	roomy?: boolean;
	/** Whether it leads a page of its own, rather than following the questions. */
	leading?: boolean;
	/** Render directly on the card/sheet surface without an outer bordered frame. */
	flat?: boolean;
	/** First keyboard stop id when this decision is its own step. */
	stop?: string;
	/** Advance to the next step on Enter when stepping through a card. */
	onNext?: () => void;
}): JSX.Element {
	const pick = (next: PlanChoice) => onChoice(toggleDecision(choice, next));
	const approved = !unanswered && (choice === "approve" || choice === "review");
	const locked = reviewRequired !== null;
	const effectiveReview = locked || review || choice === "review";
	const effectiveArchive = !effectiveReview && archive;
	const requiredLabel = reviewRequired === "one-way" ? "One-way" : "Invasive";
	const approveDetail = unanswered
		? "Answer every question first"
		: !approved
			? "Build and land this plan"
			: effectiveReview
				? "Build, then wait for your review"
				: effectiveArchive
					? "Build, merge, and archive"
					: "Build and merge";
	return (
		<DecisionPanel
			label="Plan decision"
			title="Approve this plan?"
			flat={flat}
			onKeyDown={
				onNext === undefined
					? undefined
					: (event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								onNext();
							}
						}
			}
			className={
				flat
					? cn("px-4 py-4", roomy && "px-4 py-4")
					: cn(
							"mx-4 mt-1 mb-4 @max-md:mx-3",
							roomy && "mx-5 @max-md:mx-5",
							leading && "mt-4",
						)
			}
		>
			<Card
				className={cn(
					"shadow-none transition-[border-color,background-color,box-shadow]",
					!roomy && "rounded-lg",
					approved && "border-success/50",
				)}
			>
				<button
					type="button"
					aria-label="Approve"
					aria-pressed={approved}
					disabled={unanswered}
					data-stop={!unanswered ? stop : undefined}
					onClick={() => pick("approve")}
					className={cn(
						"flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/20 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
						roomy && "px-3.5 py-3",
						approved && "bg-success/[0.06] hover:bg-success/[0.08]",
					)}
				>
					<span
						className={cn(
							"flex text-muted-foreground [&_svg]:size-4",
							approved && "text-success",
						)}
					>
						{planDecisionIcon("approve")}
					</span>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="font-medium text-sm">
							{PLAN_DECISIONS.approve.title}
						</span>
						<span className="truncate text-muted-foreground text-xs">
							{approveDetail}
						</span>
					</span>
					<span
						aria-hidden="true"
						className={cn(
							"size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/40",
							approved && "border-[5px] border-success",
						)}
					/>
				</button>
				{approved && (
					<div className="border-t bg-foreground/[0.018] py-1">
						<NestedOption
							checked={effectiveReview}
							locked={locked}
							disabled={locked}
							roomy={roomy}
							title="Review before merge"
							badge={locked ? `Required by ${requiredLabel}` : undefined}
							detail={
								locked
									? `${requiredLabel} plans pause at Ready to merge`
									: "Pause at Ready to merge before landing"
							}
							onToggle={() => onReview?.(!effectiveReview)}
						/>
						<NestedOption
							checked={effectiveArchive}
							disabled={effectiveReview}
							roomy={roomy}
							title="Archive after merge"
							detail={
								effectiveReview
									? "Available only for uninterrupted merges"
									: "Clear from your inbox once merged cleanly"
							}
							onToggle={() => onArchive?.(!archive)}
						/>
					</div>
				)}
			</Card>
			<DecisionOption
				picked={choice === "revise"}
				onPick={() => pick("revise")}
				icon={planDecisionIcon("revise")}
				title={PLAN_DECISIONS.revise.title}
				detail={PLAN_DECISIONS.revise.detail}
				roomy={roomy}
				stop={unanswered ? stop : undefined}
			/>
		</DecisionPanel>
	);
}

/**
 * Computes default post-approval options from a plan's `**Tags:**` field:
 * One-way or Invasive locks Review before merge on; Small + Reversible +
 * Self-contained (with no watch-out tags) defaults Archive after merge on;
 * everything else defaults both off.
 */
export function planApprovalDefaults(body: string): PlanApprovalDefaults {
	const reviewRequired: PlanReviewRequired = planHasOneWayTag(body)
		? "one-way"
		: planHasInvasiveTag(body)
			? "invasive"
			: null;
	if (reviewRequired !== null) {
		return { reviewRequired, review: true, archive: false };
	}
	const parsed = planFields(body);
	if (parsed === null) {
		return { reviewRequired: null, review: false, archive: false };
	}
	const tags = new Set(
		parsed.fields
			.filter((field) => /^tags$/i.test(field.label))
			.flatMap((field) => planTags(field.body))
			.map((tag) =>
				tag.name
					.toLowerCase()
					.replace(/\s+until\b.*$/, "")
					.trim(),
			),
	);
	const small = tags.has("small");
	const reversible = tags.has("reversible") || tags.has("clean revert");
	const selfContained = tags.has("self-contained");
	const hasWatchOut = [...tags].some((tag) => WATCH_OUT_TAGS.has(tag));
	return {
		reviewRequired: null,
		review: false,
		archive: small && reversible && selfContained && !hasWatchOut,
	};
}

const WATCH_OUT_TAGS = new Set(["breaking", "security", "paid", "costs money"]);

/** Display metadata for each plan decision choice, shared by picker and review card. */
export const PLAN_DECISIONS: Record<
	PlanChoice,
	{ title: string; detail: string; accent: boolean }
> = {
	approve: {
		title: "Approve",
		detail: "Build and merge",
		accent: true,
	},
	review: {
		title: "Approve & review",
		detail: "Build, then wait for your review",
		accent: true,
	},
	revise: {
		title: "Request changes",
		detail: "Revise from your answers",
		accent: false,
	},
};

/** Display summary for a picked plan decision including its Review and Archive options. */
export function planDecisionSummary(
	choice: PlanChoice,
	{
		review = false,
		archive = false,
	}: { review?: boolean; archive?: boolean } = {},
): { title: string; detail: string; accent: boolean; icon: JSX.Element } {
	if (choice === "revise") {
		return { ...PLAN_DECISIONS.revise, icon: planDecisionIcon("revise") };
	}
	if (choice === "review" || review) {
		return { ...PLAN_DECISIONS.review, icon: planDecisionIcon("review") };
	}
	if (archive) {
		return {
			title: "Approve & archive",
			detail: "Build, merge, and archive",
			accent: true,
			icon: planDecisionIcon("approve"),
		};
	}
	return { ...PLAN_DECISIONS.approve, icon: planDecisionIcon("approve") };
}

/** Icon for a plan decision choice, shared between picker rows and review summary. */
export function planDecisionIcon(choice: PlanChoice): JSX.Element {
	if (choice === "approve") {
		return <CheckCheckIcon />;
	}
	if (choice === "review") {
		return <CheckIcon />;
	}
	return <PencilIcon />;
}

/** One secondary checkbox nested inside the expanded Approve option. */
function NestedOption({
	checked,
	locked = false,
	disabled = false,
	roomy,
	title,
	badge,
	detail,
	onToggle,
}: {
	checked: boolean;
	locked?: boolean;
	disabled?: boolean;
	roomy: boolean;
	title: string;
	badge?: string;
	detail: string;
	onToggle: () => void;
}): JSX.Element {
	return (
		<label
			className={cn(
				"flex w-full cursor-pointer items-start gap-2.5 text-left transition-colors hover:bg-foreground/[0.025] has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
				roomy ? "px-3.5 py-2.5" : "py-2 pr-3 pl-9.5",
				disabled && "cursor-default hover:bg-transparent",
				disabled && !locked && "opacity-55",
			)}
		>
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				aria-label={title}
				onChange={onToggle}
				className="sr-only"
			/>
			<span
				aria-hidden="true"
				className={cn(
					"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-muted-foreground/45 bg-card text-primary-foreground",
					checked && !locked && "border-foreground bg-foreground",
					locked && "border-transparent bg-foreground/45",
				)}
			>
				{locked ? (
					<LockIcon className="size-2.5" />
				) : checked ? (
					<CheckIcon className="size-3" />
				) : null}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex flex-wrap items-center gap-1.5">
					<span className="font-medium text-[13px] leading-snug">{title}</span>
					{badge !== undefined && (
						<span className="rounded-full bg-destructive/10 px-1.5 py-0.5 font-medium text-[10.5px] text-destructive leading-none">
							{badge}
						</span>
					)}
				</span>
				<span className="text-[11.5px] text-muted-foreground leading-snug">
					{detail}
				</span>
			</span>
		</label>
	);
}

/**
 * The frame a decision is asked in: a heading "Your decision" with the
 * question it asks, over its toggleable `DecisionOption` choices. Uses a
 * subtle tinted box inline, or sits flat directly on the surface when stepped.
 */
export function DecisionPanel({
	label,
	title,
	flat = false,
	className,
	onKeyDown,
	children,
}: {
	/** What the section is called for assistive tech. */
	label: string;
	/** The question asked, as the panel's heading. */
	title: ReactNode;
	/** Omit the outer bordered wrapper when rendered as its own clean step. */
	flat?: boolean;
	className?: string;
	onKeyDown?: (event: KeyboardEvent<HTMLFieldSetElement>) => void;
	children: ReactNode;
}): JSX.Element {
	const heading = useId();
	const keys = (event: KeyboardEvent<HTMLFieldSetElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			const buttons = [
				...event.currentTarget.querySelectorAll<HTMLButtonElement>(
					"button[aria-pressed]:not(:disabled)",
				),
			];
			const at = buttons.indexOf(event.target as HTMLButtonElement);
			if (at !== -1 && buttons.length > 0) {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				buttons[(at + step + buttons.length) % buttons.length]?.focus();
				return;
			}
		}
		onKeyDown?.(event);
	};
	return (
		<section
			aria-label={label}
			className={cn(
				!flat && "rounded-xl border bg-success/[0.035] p-3",
				className,
			)}
		>
			<p className="flex items-center gap-1.5 font-semibold text-success text-xs uppercase tracking-wide">
				<ShieldCheckIcon className="size-4" />
				Your decision
			</p>
			<p
				id={heading}
				className={cn(
					"mt-1.5 font-semibold",
					flat ? "mb-3 text-base" : "mb-2.5 text-[15px]",
				)}
			>
				{title}
			</p>
			<fieldset
				aria-labelledby={heading}
				onKeyDown={keys}
				className={cn(
					"m-0 flex min-w-0 flex-col border-0 p-0",
					flat ? "gap-2" : "gap-1.5",
				)}
			>
				{children}
			</fieldset>
		</section>
	);
}

/**
 * One option of a `DecisionPanel`: a toggleable choice with an icon, a title
 * and a line under it. Clicking a picked option again undoes the pick.
 */
export function DecisionOption({
	picked,
	disabled = false,
	onPick,
	icon,
	title,
	detail,
	roomy,
	accent = false,
	stop,
}: {
	picked: boolean;
	disabled?: boolean;
	onPick: () => void;
	icon: ReactNode;
	title: string;
	detail: string;
	roomy: boolean;
	/** Whether its icon turns green when picked, as approval's check does. */
	accent?: boolean;
	/** The question it is the first stop of, for Tab and arrival. */
	stop?: string;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={title}
			aria-pressed={picked}
			disabled={disabled}
			onClick={onPick}
			data-stop={stop}
			className={cn(
				"flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left outline-none transition-[border-color,background-color,box-shadow] hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60",
				roomy && "rounded-xl px-3.5 py-3",
				picked &&
					(accent
						? "border-success/50 bg-success/[0.06]"
						: "border-foreground/35 bg-muted/40"),
			)}
		>
			<span
				className={cn(
					"flex text-muted-foreground [&_svg]:size-4",
					picked && (accent ? "text-success" : "text-foreground"),
				)}
			>
				{icon}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="font-medium text-sm">{title}</span>
				<span className="truncate text-muted-foreground text-xs">{detail}</span>
			</span>
			<span
				aria-hidden="true"
				className={cn(
					"size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/40",
					picked &&
						(accent
							? "border-[5px] border-success"
							: "border-[5px] border-foreground"),
				)}
			/>
		</button>
	);
}
