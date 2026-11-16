import { CheckIcon, CircleIcon, Loader2Icon, XIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";
import type { Standing } from "./merge-checklist";

/** The rail every timeline in the app shares: its steps, joined by a line. */
export function StepTimeline({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<ol aria-label={label} className="px-4 py-3 @max-md:px-3">
			{children}
		</ol>
	);
}

/**
 * One step on the rail: its icon, its `line` (with `onPress` it is a button),
 * and under it `children`. `last` ends the joining line.
 */
export function StepTimelineItem({
	label,
	standing,
	last,
	line,
	onPress,
	pressTitle,
	expanded,
	status,
	wrap,
	children,
}: {
	label: string;
	standing: Standing;
	last: boolean;
	line: ReactNode;
	onPress?: (() => void) | null;
	pressTitle?: string;
	expanded?: boolean;
	status?: string;
	/** Let a long line wrap onto more rows instead of keeping one. */
	wrap?: boolean;
	children?: ReactNode;
}): JSX.Element {
	return (
		<li
			aria-label={`${label}, ${standingWord(standing)}`}
			data-status={status}
			className="relative flex gap-3"
		>
			{!last && (
				<span
					aria-hidden
					className={cn(
						"absolute top-5 bottom-0 left-[7px] w-px",
						standing === "done" ? "bg-success/50" : "bg-border",
					)}
				/>
			)}
			<span className="z-10 flex h-6 items-center bg-card">
				<Mark standing={standing} className="size-[15px]" />
			</span>
			<div className="min-w-0 flex-1 pb-1.5">
				{onPress ? (
					<button
						type="button"
						title={pressTitle}
						aria-expanded={expanded}
						onClick={onPress}
						className="group/step -mx-1.5 flex h-6 w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
					>
						{line}
					</button>
				) : (
					<div
						className={cn(
							"flex items-center gap-2 text-sm",
							wrap ? "min-h-6 py-0.5" : "h-6",
						)}
					>
						{line}
					</div>
				)}
				{children}
			</div>
		</li>
	);
}

/** The words a screen reader gets for a step's standing. */
export function standingWord(standing: Standing): string {
	switch (standing) {
		case "done":
			return "done";
		case "running":
			return "under way";
		case "next":
			return "to come";
		case "failed":
			return "failed";
	}
}

/** The step icon: a check, a cross, a spinner or an empty circle. */
export function Mark({
	standing,
	className,
}: {
	standing: Standing;
	className: string;
}): JSX.Element {
	if (standing === "done" || standing === "failed") {
		const Icon = standing === "done" ? CheckIcon : XIcon;
		return (
			<span
				className={cn(
					"flex shrink-0 items-center justify-center rounded-full text-white",
					standing === "done" ? "bg-success" : "bg-destructive",
					className,
				)}
			>
				<Icon className="size-[70%]" strokeWidth={3.5} />
			</span>
		);
	}
	if (standing === "running") {
		return (
			<Loader2Icon
				className={cn("shrink-0 animate-spin text-muted-foreground", className)}
			/>
		);
	}
	return (
		<CircleIcon
			className={cn("shrink-0 text-muted-foreground/40", className)}
		/>
	);
}
