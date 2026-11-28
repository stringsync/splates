import {
	CheckCheckIcon,
	CheckIcon,
	CircleDashedIcon,
	type LucideIcon,
	ShieldCheckIcon,
} from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * Where a question stands, as its step shows it: no answer yet, an answer
 * the agent picked that the person has not looked at, or an answer they
 * have seen.
 */
export type StepState = "unanswered" | "picked" | "seen";

const marks: Record<StepState, { Icon: LucideIcon; words: string }> = {
	unanswered: { Icon: CircleDashedIcon, words: "unanswered" },
	picked: { Icon: CheckIcon, words: "picked, not yet seen" },
	seen: { Icon: CheckCheckIcon, words: "answered and seen" },
};

/**
 * The row of tappable steps above a stepped card (on both desktop and phone
 * sheets): a pill per question marked with where it stands, an optional green
 * Decide pill for a plan's decision, a Review pill for confirmation & send,
 * the current step label, and desktop's optional "Show all" toggle.
 */
export function QuestionSteps({
	states,
	page,
	ruled,
	deciding = false,
	reviewing = true,
	roomy = false,
	onTurn,
	onWhole,
}: {
	/** Where each question stands, in order. */
	states: StepState[];
	/** The step shown, by position. */
	page: number;
	/** Whether a rule sets it apart from what is above it. */
	ruled: boolean;
	/** Whether a plan's decision follows the questions as a step of its own, at `states.length`. */
	deciding?: boolean;
	/** Whether a final Review & send step follows the questions (and decision, when present). */
	reviewing?: boolean;
	/** Larger touch-friendly pills inside mobile sheets. */
	roomy?: boolean;
	onTurn: (to: number) => void;
	/** Desktop-only callback to expand every question down the card. */
	onWhole?: () => void;
}): JSX.Element {
	const decisionPage = deciding ? states.length : null;
	const reviewPage = deciding ? states.length + 1 : states.length;
	const pillSize = roomy ? "h-7 px-2.5 text-xs" : "h-6 px-2 text-[11px]";
	const label =
		page < states.length
			? states.length > 1
				? `Question ${page + 1} of ${states.length}`
				: null
			: decisionPage !== null && page === decisionPage
				? "Your decision"
				: "Review & send";
	return (
		<nav
			aria-label="question steps"
			className={cn(
				"flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5",
				ruled && "rule-t",
			)}
		>
			{states.map((state, at) => {
				const { Icon, words } = marks[state];
				const current = at === page;
				return (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: a step is its position
						key={at}
						type="button"
						aria-current={current ? "step" : undefined}
						aria-label={`question ${at + 1}, ${words}`}
						onClick={() => onTurn(at)}
						className={cn(
							"inline-flex cursor-pointer items-center gap-1 rounded-full border font-medium tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
							pillSize,
							current
								? "border-primary bg-primary text-primary-foreground"
								: "border-border bg-muted text-foreground hover:bg-muted/70",
						)}
					>
						{at + 1}
						{/* Centered on the digits' height, which sit half a pixel above the line's middle. */}
						<Icon
							aria-hidden
							className="size-3 shrink-0 -translate-y-[0.5px]"
						/>
					</button>
				);
			})}
			{decisionPage !== null && (
				<button
					type="button"
					aria-current={page === decisionPage ? "step" : undefined}
					aria-label="plan decision"
					onClick={() => onTurn(decisionPage)}
					className={cn(
						"inline-flex cursor-pointer items-center gap-1 rounded-full border font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
						pillSize,
						page === decisionPage
							? "border-success bg-success text-white dark:text-success-foreground"
							: "border-border bg-muted text-success hover:bg-muted/70",
					)}
				>
					<ShieldCheckIcon aria-hidden className="size-3 shrink-0" />
					Decide
				</button>
			)}
			{reviewing && (
				<button
					type="button"
					aria-current={page === reviewPage ? "step" : undefined}
					aria-label="review and send"
					onClick={() => onTurn(reviewPage)}
					className={cn(
						"inline-flex cursor-pointer items-center gap-1 rounded-full border font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
						pillSize,
						page === reviewPage
							? "border-primary bg-primary text-primary-foreground"
							: "border-border bg-muted text-foreground hover:bg-muted/70",
					)}
				>
					<CheckIcon aria-hidden className="size-3 shrink-0" />
					Review
				</button>
			)}
			<span className="flex-1" />
			{label !== null && (
				<span className="mr-1 text-muted-foreground text-xs tabular-nums">
					{label}
				</span>
			)}
			{onWhole !== undefined && (
				<button
					type="button"
					onClick={onWhole}
					className="cursor-pointer rounded-md px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
				>
					Show all
				</button>
			)}
		</nav>
	);
}
