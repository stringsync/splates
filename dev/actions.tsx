import type { JSX, ReactNode } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";

/** Something to do with a conversation, or a place in it to go to. */
export interface Action {
	label: string;
	icon: ReactNode;
	/** Beside the label, such as a task's +/- counts. */
	detail?: ReactNode;
	/** Null for a row that only says something, such as "No open questions". */
	run: (() => void) | null;
	/** Calls for you, as open questions do: its count on its icon button. */
	count?: number;
}

/**
 * Everything to do with a conversation, in a card floating in its upper
 * right, many of them opening the pane beside the page. Only where the
 * conversation leaves room beside its messages, `ActionButtons` standing
 * in for it elsewhere.
 */
export function Actions({ actions }: { actions: Action[] }): JSX.Element {
	return (
		<nav
			aria-label="actions"
			className="absolute top-2 right-2 z-10 hidden w-56 flex-col gap-0.5 rounded-xl border bg-popover/95 p-1 text-popover-foreground shadow-sm backdrop-blur @6xl:flex"
		>
			<p className="px-2 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">
				Actions
			</p>
			{actions.map((action) =>
				action.run === null ? (
					<p
						key={action.label}
						className="flex h-7 items-center gap-1.5 px-2.5 text-muted-foreground text-xs [&_svg]:size-3.5"
					>
						{action.icon}
						<span className="flex-1">{action.label}</span>
						{action.detail}
					</p>
				) : (
					<Button
						key={action.label}
						variant="ghost"
						size="sm"
						onClick={action.run}
						className={cn(
							"justify-start",
							// A count's icon keeps its own color.
							action.count === undefined && "[&_svg]:text-muted-foreground",
						)}
					>
						{action.icon}
						<span className="flex-1 text-left">{action.label}</span>
						{action.detail}
					</Button>
				),
			)}
		</nav>
	);
}

/** The actions as icons, for a conversation too narrow for their card. */
export function ActionButtons({ actions }: { actions: Action[] }): JSX.Element {
	return (
		<div className="flex gap-1 @6xl:hidden">
			{actions.map(({ label, icon, run, count }) =>
				run === null ? null : (
					<Button
						key={label}
						variant="outline"
						size="icon-sm"
						title={label}
						aria-label={label}
						onClick={run}
						className={cn(count !== undefined && "relative")}
					>
						{icon}
						{count !== undefined && count > 0 && (
							<span
								aria-hidden
								className="-top-1.5 -right-1.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-medium text-[10px] text-background tabular-nums"
							>
								{count}
							</span>
						)}
					</Button>
				),
			)}
		</div>
	);
}
