import { ChevronRightIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";
import { HEADING } from "./markdown";

/**
 * One section of a card or dialog: an underlined heading with a chevron that
 * opens and closes what is under it. `label` names the region for assistive
 * tech and tests; the button is named by `title`. `aside` sits beside the
 * heading, outside the button, so using it never folds the section. Closed,
 * the heading drops its underline so a card's own dividers are not doubled.
 */
export function CardSection({
	label,
	title,
	aside,
	defaultOpen = true,
	className,
	children,
}: {
	label: string;
	title: ReactNode;
	aside?: ReactNode;
	defaultOpen?: boolean;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<Collapsible
			defaultOpen={defaultOpen}
			render={<section aria-label={label} />}
			className={cn("group/section min-w-0", className)}
		>
			<h2
				className={cn(
					HEADING,
					"mt-0 mb-0 flex min-h-7 items-center gap-2 group-not-data-[open]/section:border-transparent pointer-coarse:min-h-10",
				)}
			>
				<CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
					<ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-150 group-data-[open]/section:rotate-90" />
					{title}
				</CollapsibleTrigger>
				{aside}
			</h2>
			<CollapsibleContent className="pt-2">{children}</CollapsibleContent>
		</Collapsible>
	);
}
