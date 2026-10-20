import { ChevronRightIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";

/** The card itself; a phone's rows reach its edges, as they do the screen's. */
const CARD =
	"group/card flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs";

/** The header's row, the line under it there only while the body shows. */
const HEADER =
	"flex min-h-11 w-full items-center gap-2 px-4 text-left font-semibold text-sm";

/**
 * A section of the Tasks page: a card headed by its `title` and how many it
 * holds, null while that is not known. With `onOpenChange`, the header folds
 * the body away.
 */
export function TasksCard({
	label,
	title,
	count,
	open,
	onOpenChange,
	children,
}: {
	/** The section's accessible name. */
	label: string;
	title: string;
	count: number | null;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}): JSX.Element {
	const heading = (
		<>
			{title}
			{count !== null && (
				<span className="rounded-full bg-muted px-1.5 font-medium text-[11px] text-muted-foreground tabular-nums leading-[18px]">
					{count}
				</span>
			)}
		</>
	);
	if (onOpenChange === undefined) {
		return (
			<section aria-label={label} className={CARD}>
				<div className={`${HEADER} border-b`}>{heading}</div>
				<div className="px-4 py-1">{children}</div>
			</section>
		);
	}
	return (
		<Collapsible
			open={open}
			onOpenChange={onOpenChange}
			render={<section aria-label={label} />}
			className={CARD}
		>
			<CollapsibleTrigger
				className={`${HEADER} cursor-pointer outline-none hover:bg-muted/50 focus-visible:bg-muted/50 group-data-[open]/card:border-b`}
			>
				{heading}
				<ChevronRightIcon
					aria-hidden
					className="ml-auto size-4 text-muted-foreground transition-transform duration-150 group-data-[open]/card:rotate-90"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="px-4 py-1">{children}</CollapsibleContent>
		</Collapsible>
	);
}
