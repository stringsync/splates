import { LightbulbIcon, type LucideIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";
import { Markdown } from "./markdown";

/**
 * What is indented under a choice, as its screenshot, lined up with its text
 * unless `inset` is off, where it already sits under the text.
 */
export function ChoiceBody({
	body,
	inset = true,
}: {
	body: string;
	inset?: boolean;
}): JSX.Element | null {
	return body === "" ? null : (
		<Markdown
			text={body}
			className={cn(
				"text-[13px] text-muted-foreground leading-relaxed [&_p]:my-0",
				inset && "pr-3 pb-2 pl-11",
			)}
		/>
	);
}

/**
 * Why the agent would go with a choice, or not, once its question's reasons
 * are shown: muted under its text, lined up with it unless `inset` is off.
 */
export function WhyLine({
	why,
	inset = true,
}: {
	why: string;
	inset?: boolean;
}): JSX.Element | null {
	return why === "" ? null : (
		<Markdown
			text={why}
			className={cn(
				"text-[13px] text-muted-foreground leading-relaxed [&_p]:my-0",
				inset && "pr-3 pb-2 pl-11",
			)}
		/>
	);
}

/**
 * One switch per question that shows every choice's Why at once, off until
 * turned on, so a card reads as its choices alone. `one` where there is a
 * single reason to show.
 */
export function WhySwitch({
	on,
	onTurn,
	one = false,
}: {
	on: boolean;
	onTurn: (on: boolean) => void;
	one?: boolean;
}): JSX.Element {
	const reasons = one ? "reason" : "reasons";
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={() => onTurn(!on)}
			className={cn(
				"inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40",
				on && "bg-muted text-foreground",
			)}
		>
			<LightbulbIcon className="size-3.5" />
			{on ? `Hide ${reasons}` : `Show ${reasons}`}
		</button>
	);
}

/**
 * How a question's choices are answered, led by an icon of its own, so a
 * question taking one choice reads apart from one taking any at a glance.
 */
export function HowToPick({
	Icon,
	text,
}: {
	Icon: LucideIcon;
	text: string;
}): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground">
			<Icon className="size-3.5" />
			{text}
		</span>
	);
}
