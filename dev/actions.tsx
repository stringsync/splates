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
 * Everything to do with a conversation, in a panel in its upper right, many
 * of them opening the pane beside the page: the first, what it waits on you
 * for, above a rule, the rest below it. Only where the conversation leaves
 * room beside its messages, `ActionButtons` standing in for it elsewhere.
 */
export function Actions({ actions }: { actions: Action[] }): JSX.Element {
	const [status, ...rest] = actions;
	return (
		<nav
			aria-label="actions"
			className="absolute top-2 right-2 z-10 hidden w-60 flex-col divide-y overflow-hidden rounded-lg border bg-background @6xl:flex"
		>
			{status !== undefined && (
				<div className="py-1">
					<ActionRow action={status} />
				</div>
			)}
			{rest.length > 0 && (
				<div className="py-1">
					{rest.map((action) => (
						<ActionRow key={action.label} action={action} />
					))}
				</div>
			)}
		</nav>
	);
}

/** One action, or a row that only says something when it has nothing to run. */
function ActionRow({ action }: { action: Action }): JSX.Element {
	const row =
		"flex h-8 w-full items-center gap-2 px-3 text-left text-sm [&_svg]:size-4";
	const detail = action.detail && (
		<span className="text-muted-foreground">{action.detail}</span>
	);
	return action.run === null ? (
		<p className={cn(row, "text-muted-foreground")}>
			{action.icon}
			<span className="flex-1">{action.label}</span>
			{detail}
		</p>
	) : (
		<button
			type="button"
			onClick={action.run}
			className={cn(
				row,
				"transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
				// A count's icon keeps its own color.
				action.count === undefined && "[&_svg]:text-muted-foreground",
			)}
		>
			{action.icon}
			<span className="flex-1">{action.label}</span>
			{detail}
		</button>
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
