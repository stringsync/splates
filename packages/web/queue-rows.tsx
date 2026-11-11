import { MoreHorizontalIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import { usePendingSnapshot } from "./expecting";
import { pendingRow, useShowPending } from "./pending";
import { TagChips } from "./tag-chips";

/** Groups some of a Queue column's cards under a small label. */
export function QueueSection({
	title,
	count,
	children,
}: {
	title: string;
	count: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<section aria-label={title} className="flex flex-col gap-1.5">
			<h4 className="flex items-center gap-1.5 px-1.5 pt-1 text-muted-foreground text-xs">
				{title}
				<span className="tabular-nums">{count}</span>
			</h4>
			<div className="flex flex-col gap-1.5">{children}</div>
		</section>
	);
}

/** What a section says while it holds nothing. */
export function QueueEmpty({ children }: { children: ReactNode }): JSX.Element {
	return (
		<p className="px-1.5 pb-1 text-muted-foreground text-sm">{children}</p>
	);
}

/** A button on a row: what it says and does. */
// vet-ignore objects-over-callbacks: a button's label and click, as a component's prop item
export interface RowAction {
	label: string;
	onClick: () => void;
	disabled?: boolean;
}

/**
 * A card of the Queue page for work that is no board task, as an agent at
 * work: its name, a quiet line of who started it, how long and its number,
 * then its actions, the menu first and the main one last.
 */
export function QueueRow({
	name,
	tags,
	by,
	age,
	id,
	marks,
	menu,
	quiet,
	main,
	pending: writing = false,
	pendingKey,
}: {
	name: ReactNode;
	/** The task's tags, as chips after its name. */
	tags?: readonly string[];
	by?: ReactNode;
	age?: ReactNode;
	id?: ReactNode;
	/** Marks after the name, as an agent waiting on the person. */
	marks?: ReactNode;
	/** The menu's items, every action past the two buttons. */
	menu?: ReactNode;
	/** The quieter action, a ghost button, moved into the menu on a phone. */
	quiet?: RowAction;
	/** The main action, an outline button. */
	main?: RowAction;
	/** A write to it is on its way: dimmed after a moment, its buttons held. */
	pending?: boolean;
	/** What a write to this row touches (`todo:3`, `lane:2`): the row shows it pending. */
	pendingKey?: string;
}): JSX.Element {
	const keyed = usePendingSnapshot(pendingKey ?? "");
	const pending = writing || keyed;
	const showPending = useShowPending(pending);
	const meta = [by, age, id].filter(
		(each) => each !== undefined && each !== null && each !== "",
	);
	return (
		<div
			{...pendingRow(
				pending,
				showPending,
				"flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-2 pl-3 text-card-foreground text-sm transition-colors hover:border-border",
			)}
		>
			<span className="flex min-w-0 items-start gap-1.5">
				<span className="min-w-0 flex-1 break-words font-medium">{name}</span>
				{marks}
			</span>
			<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
				<TagChips tags={tags} />
				{meta.map((each, at) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed few, in order
					<span key={at} className="min-w-0 truncate tabular-nums">
						{each}
					</span>
				))}
			</span>
			{(quiet !== undefined || main !== undefined || menu !== undefined) && (
				<span className="flex items-center justify-end gap-1">
					<RowMenu quiet={quiet} pending={pending}>
						{menu}
					</RowMenu>
					{quiet !== undefined && (
						<Button
							size="xs"
							variant="ghost"
							className="text-muted-foreground max-md:hidden"
							disabled={quiet.disabled || pending}
							onClick={quiet.onClick}
						>
							{quiet.label}
						</Button>
					)}
					{main !== undefined && (
						<Button
							size="xs"
							variant="outline"
							className="max-md:h-8 max-md:px-3 max-md:text-sm"
							disabled={main.disabled || pending}
							onClick={main.onClick}
						>
							{main.label}
						</Button>
					)}
				</span>
			)}
		</div>
	);
}

/**
 * The row's menu, with the quieter action at its head on a phone, where
 * the row has no room for its button; none when it would be empty.
 */
function RowMenu({
	quiet,
	pending,
	children,
}: {
	quiet: RowAction | undefined;
	pending: boolean;
	children: ReactNode;
}): JSX.Element | null {
	const empty =
		children === undefined || children === null || children === false;
	if (empty && quiet === undefined) {
		return <span className="size-6 shrink-0 max-md:size-9" />;
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="More actions"
						disabled={pending}
						className={cn(
							"text-muted-foreground max-md:size-9",
							empty && "md:invisible",
						)}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className={cn("w-56", touchItems)}>
				{quiet !== undefined && <QuietItem quiet={quiet} />}
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The quieter action as a menu item, shown on a phone alone. */
function QuietItem({ quiet }: { quiet: RowAction }): JSX.Element {
	return (
		<DropdownMenuItem
			className="md:hidden"
			disabled={quiet.disabled}
			onClick={quiet.onClick}
		>
			{quiet.label}
		</DropdownMenuItem>
	);
}
