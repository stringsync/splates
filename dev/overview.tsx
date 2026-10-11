import type { JSX, ReactNode } from "react";
import { Button } from "#dev/components/ui/button.tsx";

/** Something to do with a conversation, from its overview. */
export interface Action {
	label: string;
	icon: ReactNode;
	/** Beside the label, such as a task's +/- counts. */
	detail?: ReactNode;
	run: () => void;
}

/**
 * Everything to do with a conversation, in a card floating in its upper
 * right, many of them opening the pane beside the page. Only where the
 * conversation leaves room beside its messages, `OverviewButtons` standing
 * in for it elsewhere.
 */
export function Overview({ actions }: { actions: Action[] }): JSX.Element {
	return (
		<nav
			aria-label="overview"
			className="absolute top-2 right-2 z-10 hidden w-56 flex-col gap-0.5 rounded-xl border bg-popover/95 p-1 text-popover-foreground shadow-sm backdrop-blur @6xl:flex"
		>
			<p className="px-2 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">
				Overview
			</p>
			{actions.map((action) => (
				<Button
					key={action.label}
					variant="ghost"
					size="sm"
					onClick={action.run}
					className="justify-start [&_svg]:text-muted-foreground"
				>
					{action.icon}
					<span className="flex-1 text-left">{action.label}</span>
					{action.detail}
				</Button>
			))}
		</nav>
	);
}

/** The overview's actions as icons, for a conversation too narrow for its card. */
export function OverviewButtons({
	actions,
}: {
	actions: Action[];
}): JSX.Element {
	return (
		<div className="flex gap-1 @6xl:hidden">
			{actions.map((action) => (
				<Button
					key={action.label}
					variant="outline"
					size="icon-sm"
					title={action.label}
					aria-label={action.label}
					onClick={action.run}
				>
					{action.icon}
				</Button>
			))}
		</div>
	);
}
