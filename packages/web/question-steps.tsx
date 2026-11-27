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
 * The row of steps above a desktop card's one question at a time: a step
 * per question that turns to it, each marked with where it stands, the
 * place it is at, and "Show all", which shows every question down the card.
 */
export function QuestionSteps({
	states,
	page,
	ruled,
	deciding = false,
	onTurn,
	onWhole,
}: {
	/** Where each question stands, in order. */
	states: StepState[];
	/** The question shown, by position. */
	page: number;
	/** Whether a rule sets it apart from what is above it. */
	ruled: boolean;
	/** Whether a plan's decision follows the questions as a step of its own, at `states.length`. */
	deciding?: boolean;
	onTurn: (to: number) => void;
	onWhole: () => void;
}): JSX.Element {
	return (
		<nav
			aria-label="question steps"
			className={cn(
				"flex flex-wrap items-center gap-1.5 px-4 py-2.5",
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
							"inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 font-medium text-[11px] tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
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
			{deciding && (
				<button
					type="button"
					aria-current={page === states.length ? "step" : undefined}
					aria-label="plan decision"
					onClick={() => onTurn(states.length)}
					className={cn(
						"inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 font-medium text-[11px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
						page === states.length
							? "border-primary bg-primary text-primary-foreground"
							: "border-border bg-muted text-success hover:bg-muted/70",
					)}
				>
					<ShieldCheckIcon aria-hidden className="size-3 shrink-0" />
					Decide
				</button>
			)}
			<span className="flex-1" />
			<span className="mr-1 text-muted-foreground text-xs tabular-nums">
				{page < states.length
					? `Question ${page + 1} of ${states.length}`
					: "Your decision"}
			</span>
			<button
				type="button"
				onClick={onWhole}
				className="cursor-pointer rounded-md px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
			>
				Show all
			</button>
		</nav>
	);
}
