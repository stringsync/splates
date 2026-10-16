import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import type { JSX } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#dev/components/ui/collapsible.tsx";
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
 * Why the agent would go with a choice, or not, closed until opened, so a
 * card reads as its choices alone. Lined up with its text unless `inset` is
 * off, as `ChoiceBody` is.
 */
export function ChoiceWhy({
	why,
	inset = true,
}: {
	why: string;
	inset?: boolean;
}): JSX.Element | null {
	return why === "" ? null : (
		<Collapsible
			render={<div />}
			className={cn("group/why", inset && "pr-3 pb-2 pl-11")}
		>
			<CollapsibleTrigger className="flex cursor-pointer items-center gap-1 rounded-sm font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
				<ChevronRightIcon className="size-3.5 transition-transform duration-150 group-data-[open]/why:rotate-90" />
				Why
			</CollapsibleTrigger>
			<CollapsibleContent>
				<Markdown
					text={why}
					className="pt-1 text-[13px] text-muted-foreground leading-relaxed [&_p]:my-0"
				/>
			</CollapsibleContent>
		</Collapsible>
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
