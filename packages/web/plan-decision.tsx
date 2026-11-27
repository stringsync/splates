import {
	CheckCheckIcon,
	CheckIcon,
	PencilIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { type JSX, type KeyboardEvent, type ReactNode, useId } from "react";
import { cn } from "#web/lib/utils.ts";
import { toggleDecision } from "./card-send-policy";

/** Approve, approve with a review before it merges, or request changes. */
export type PlanChoice = "approve" | "review" | "revise";

/**
 * A plan's decision, asked as its own question set apart from the others,
 * so approval is a choice the person makes rather than what Send does. Send
 * stays an ordinary Send and carries the choice picked here.
 */
export function PlanDecision({
	choice,
	onChoice,
	unanswered,
	roomy = false,
	leading = false,
}: {
	choice: PlanChoice | null;
	onChoice: (choice: PlanChoice | null) => void;
	/** Whether a question is still unanswered, which holds approval back. */
	unanswered: boolean;
	/** Whether it sits on the phone's sheet, with room for larger targets. */
	roomy?: boolean;
	/** Whether it leads a page of its own, rather than following the questions. */
	leading?: boolean;
}): JSX.Element {
	const pick = (next: PlanChoice) => onChoice(toggleDecision(choice, next));
	return (
		<DecisionPanel
			label="Plan decision"
			title="Approve this plan?"
			className={cn(
				"mx-4 mt-1 mb-4 @max-md:mx-3",
				roomy && "mx-5 @max-md:mx-5",
				leading && "mt-4",
			)}
		>
			<DecisionOption
				picked={!unanswered && choice === "approve"}
				disabled={unanswered}
				onPick={() => pick("approve")}
				icon={<CheckCheckIcon />}
				accent
				title="Approve"
				detail={unanswered ? "Answer every question first" : "Build and merge"}
				roomy={roomy}
			/>
			<DecisionOption
				picked={!unanswered && choice === "review"}
				disabled={unanswered}
				onPick={() => pick("review")}
				icon={<CheckIcon />}
				accent
				title="Approve & review"
				detail={
					unanswered
						? "Answer every question first"
						: "Build, then wait for your review"
				}
				roomy={roomy}
			/>
			<DecisionOption
				picked={choice === "revise"}
				onPick={() => pick("revise")}
				icon={<PencilIcon />}
				title="Request changes"
				detail="Revise from your answers"
				roomy={roomy}
			/>
		</DecisionPanel>
	);
}

/**
 * The frame a decision is asked in: a tinted box headed "Your decision" with
 * the question it asks, over its toggleable `DecisionOption` choices.
 */
export function DecisionPanel({
	label,
	title,
	className,
	onKeyDown,
	children,
}: {
	/** What the section is called for assistive tech. */
	label: string;
	/** The question asked, as the panel's heading. */
	title: ReactNode;
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
			className={cn("rounded-xl border bg-success/[0.035] p-3", className)}
		>
			<p className="flex items-center gap-1.5 font-semibold text-success text-xs uppercase tracking-wide">
				<ShieldCheckIcon className="size-4" />
				Your decision
			</p>
			<p id={heading} className="mt-1.5 mb-2.5 font-semibold text-[15px]">
				{title}
			</p>
			<fieldset
				aria-labelledby={heading}
				onKeyDown={keys}
				className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
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
				"flex w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60",
				roomy && "py-3",
				picked && "border-foreground/35",
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
					picked && "border-[5px] border-foreground",
				)}
			/>
		</button>
	);
}
