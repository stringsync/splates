import type { TaskRecord } from "@splates/server/board";
import type { LucideIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * The work a card acts on, its rows running the card's width under its body,
 * a heading over them when there is one.
 */
export function Panel({
	heading,
	ruled = true,
	children,
}: {
	heading?: string;
	ruled?: boolean;
	children?: ReactNode;
}): JSX.Element {
	return (
		<div className={cn(ruled && "rule-t", "text-sm")}>
			{heading !== undefined && (
				<p className="px-4 pt-2.5 pb-1 text-muted-foreground text-xs">
					{heading}
				</p>
			)}
			<ul>{children}</ul>
		</div>
	);
}

const ROW_TONES = {
	quiet: { row: "text-muted-foreground", icon: "", status: "" },
	plain: {
		row: "",
		icon: "text-muted-foreground",
		status: "text-muted-foreground",
	},
	destructive: {
		row: "border-destructive/30 bg-destructive/[0.05]",
		icon: "text-destructive",
		status: "text-destructive",
	},
};

/**
 * A task in the panel on one line, which `onOpen` opens when there is
 * somewhere to go, and where it stands.
 */
export function Row({
	todo,
	Icon,
	status,
	tone,
	onOpen,
	after,
}: {
	todo: Pick<TaskRecord, "id" | "subject">;
	Icon: LucideIcon;
	/** Left off for a task with nothing to say. */
	status?: string;
	tone: keyof typeof ROW_TONES;
	/** Left null for a task with nowhere to open. */
	onOpen: ((id: number) => void) | null;
	/** At the row's end, after its status. */
	after?: ReactNode;
}): JSX.Element {
	const { row, icon, status: toned } = ROW_TONES[tone];
	return (
		<li
			className={cn(
				"flex items-center gap-2 rule-t px-4 py-1.5 first:border-t-0 first:bg-none",
				row,
			)}
		>
			<Icon className={cn("size-3.5 shrink-0", icon)} />
			<span className="text-muted-foreground text-xs tabular-nums">
				#{todo.id}
			</span>
			{onOpen === null ? (
				<span className="min-w-0 flex-1 truncate">{todo.subject}</span>
			) : (
				<button
					type="button"
					onClick={() => onOpen(todo.id)}
					className="min-w-0 flex-1 cursor-pointer truncate rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				>
					{todo.subject}
				</button>
			)}
			{status !== undefined && (
				<span className={cn("shrink-0 text-xs", toned)}>{status}</span>
			)}
			{after}
		</li>
	);
}
