import type { GoneBlocker } from "@stringsync/splates-server/board";
import { XIcon } from "lucide-react";
import type { JSX } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";

/**
 * The todos it was blocked by that were removed without merging, which hold
 * it back until the person lets each go with its ×, once it still makes
 * sense without them.
 */
export function LostList({
	lost,
	onRemove,
}: {
	lost: GoneBlocker[];
	onRemove: (gone: GoneBlocker) => void;
}): JSX.Element | null {
	if (lost.length === 0) {
		return null;
	}
	return (
		<ul aria-label="Removed blockers" className="contents">
			{lost.map((gone) => (
				<li
					key={gone.id}
					className="group/link inline-flex h-6 pointer-coarse:h-10 items-center rounded-md bg-muted/70 text-sm"
				>
					<Tooltip>
						<TooltipTrigger
							render={<span />}
							className="cursor-default pl-2 text-warning tabular-nums line-through"
						>
							#{gone.id}
						</TooltipTrigger>
						<TooltipContent>
							{`${gone.subject}: removed without merging, so this waits on you. Let it go to start this anyway.`}
						</TooltipContent>
					</Tooltip>
					<button
						type="button"
						aria-label={`let go of removed #${gone.id}`}
						onClick={() => onRemove(gone)}
						className="flex h-full cursor-pointer items-center rounded-md px-1 pointer-coarse:px-3 text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover/link:text-muted-foreground"
					>
						<XIcon className="size-3" />
					</button>
				</li>
			))}
		</ul>
	);
}
