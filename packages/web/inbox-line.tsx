import { InboxIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * The sidebar's way to the inbox, counting the agents waiting on you, as the
 * phone drawer's Inbox does.
 */
export function InboxLine({
	waiting,
	current,
	onOpen,
}: {
	/** How many agents wait on you. */
	waiting: number;
	/** Whether the inbox is the page shown. */
	current: boolean;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			data-row
			aria-current={current ? "page" : undefined}
			onClick={onOpen}
			className={cn(
				"flex h-9 min-w-0 flex-none items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-muted [&_svg]:size-4",
				current && "bg-accent [&_svg]:text-primary",
			)}
		>
			<InboxIcon />
			<span className="flex-1 truncate">Inbox</span>
			<span
				role="status"
				aria-label={
					waiting > 0 ? `${waiting} waiting on you` : "Nothing waiting on you"
				}
				className={cn(
					"text-xs tabular-nums",
					waiting > 0 &&
						"rounded-full bg-warning px-2 py-0.5 font-medium text-background",
				)}
			>
				{waiting > 0 ? waiting : null}
			</span>
		</button>
	);
}
