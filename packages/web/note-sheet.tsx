import { ChevronDownIcon, MessageSquareIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * The classes for each width the notes sit beside their view from. Below it,
 * they float over the view's foot, so the view keeps its size however many
 * notes are added; from it, they are a column of their own width.
 */
const WIDE = {
	sm: {
		sheet:
			"max-sm:pointer-events-none max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-10 max-sm:max-h-[60%] max-sm:items-end sm:w-72 sm:shrink-0",
		narrow: "sm:hidden",
		closed: "max-sm:hidden",
		panel:
			"max-sm:pointer-events-auto max-sm:w-full max-sm:rounded-lg max-sm:bg-neutral-950 max-sm:p-3 max-sm:shadow-lg max-sm:ring-1 max-sm:ring-white/10",
	},
	md: {
		sheet:
			"max-md:pointer-events-none max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-10 max-md:max-h-[60%] max-md:items-end md:w-64 md:shrink-0",
		narrow: "md:hidden",
		closed: "max-md:hidden",
		panel:
			"max-md:pointer-events-auto max-md:w-full max-md:rounded-lg max-md:bg-neutral-950 max-md:p-3 max-md:shadow-lg max-md:ring-1 max-md:ring-white/10",
	},
} as const;

/**
 * Holds a view's comments or marks without ever resizing the view. Wrap the
 * list in it and render it beside the view, both inside one `relative` box.
 */
export function NoteSheet({
	label,
	count,
	wide,
	openOnAdd = false,
	children,
}: {
	/** What the pill calls the notes, as "Comments". */
	label: string;
	/** How many notes there are, shown on the pill. */
	count: number;
	/** The breakpoint from which the notes sit beside the view. */
	wide: keyof typeof WIDE;
	/** Whether a note added on a narrow screen opens the sheet, to write it. */
	openOnAdd?: boolean;
	children: ReactNode;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const seen = useRef(count);
	useEffect(() => {
		if (openOnAdd && count > seen.current) {
			setOpen(true);
		}
		seen.current = count;
	}, [count, openOnAdd]);
	const classes = WIDE[wide];
	return (
		<div className={cn("flex min-h-0 flex-col", classes.sheet)}>
			{!open && (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={cn(
						"pointer-events-auto m-2 flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1.5 text-sm text-white shadow-lg ring-1 ring-white/15",
						classes.narrow,
					)}
				>
					<MessageSquareIcon className="size-4" />
					{label} · {count}
				</button>
			)}
			<div
				className={cn(
					"flex min-h-0 flex-col gap-3 overflow-y-auto",
					classes.panel,
					!open && classes.closed,
				)}
			>
				<button
					type="button"
					onClick={() => setOpen(false)}
					aria-label={`Hide ${label.toLowerCase()}`}
					className={cn(
						"flex shrink-0 items-center justify-end gap-1 text-white/60 text-xs hover:text-white",
						classes.narrow,
					)}
				>
					Hide <ChevronDownIcon className="size-4" />
				</button>
				{children}
			</div>
		</div>
	);
}
