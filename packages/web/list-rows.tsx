import type { Background } from "@stringsync/splates-server/conversations";
import type { Needing } from "@stringsync/splates-server/plans/browser";
import {
	PencilIcon,
	SquareTerminalIcon,
	TerminalIcon,
	UnplugIcon,
	XIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { useNameOf } from "./conversation-names";
import { keyOfRow, lastTaskOfRow } from "./conversation-rows";
import type { Nested } from "./parts";

/**
 * The sidebar's rows as a list, each part's under the row of the task it was
 * handed out from, in a list of its own, indented, after what `beneath` puts
 * under that row, as its terminal.
 */
export function Rows({
	label,
	rows,
	render,
	beneath = () => [],
	nested = false,
	children,
}: {
	label: string;
	rows: Nested<Needing>[];
	/** Draws a row; `nested` when it sits under another. */
	render: (row: Needing, nested: boolean) => ReactNode;
	/** What a row has nested under it ahead of its parts, each an `<li>`. */
	beneath?: (row: Needing) => ReactNode[];
	nested?: boolean;
	/** `<li>`s ahead of the rows. */
	children?: ReactNode;
}): JSX.Element {
	const nameOf = useNameOf();
	return (
		<ul
			aria-label={label}
			className={cn(
				"flex flex-col",
				nested && "mt-1 ml-4 border-foreground/10 border-l pl-1",
			)}
		>
			{children}
			{rows.map(({ row, parts }) => {
				const under = beneath(row);
				return (
					<li key={keyOfRow(row)}>
						{render(row, nested)}
						{(under.length > 0 || parts.length > 0) && (
							<Rows
								label={`parts of ${lastTaskOfRow(row) ?? (row.conversation === null ? "" : nameOf(row.conversation))}`}
								rows={parts}
								render={render}
								beneath={beneath}
								nested
							>
								{under}
							</Rows>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/**
 * A terminal in the list, with an X that hangs up its shell: one of the main
 * tree's, or nested under its conversation, muted as a subagent is. Double-click
 * it, or its pencil, to rename it: Enter keeps what is typed (blank goes back
 * to the name it goes by), and Escape or leaving the box keeps the old.
 */
export function TerminalRow({
	name,
	current,
	onOpen,
	onClose,
	onRename,
	nested = false,
}: {
	name: string;
	current: boolean;
	onOpen: () => void;
	onClose: () => void;
	onRename: (name: string) => void;
	nested?: boolean;
}): JSX.Element {
	const [renaming, setRenaming] = useState(false);
	return (
		<div
			className={cn(
				"group/item relative flex items-center rounded-md text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			{renaming && (
				<RenameBox
					name={name}
					onDone={(renamed) => {
						setRenaming(false);
						if (renamed !== null) {
							onRename(renamed);
						}
					}}
				/>
			)}
			<button
				type="button"
				data-row
				aria-current={current ? "page" : undefined}
				onClick={onOpen}
				onDoubleClick={() => setRenaming(true)}
				className={cn(
					"flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-14 pl-3 text-left",
					renaming && "hidden",
				)}
			>
				<SquareTerminalIcon className="size-3.5 text-foreground/70" />
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm",
						nested && "text-muted-foreground italic",
					)}
				>
					{name}
				</span>
			</button>
			<span
				className={cn(
					"absolute right-1 flex items-center opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100",
					renaming && "hidden",
				)}
			>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={`Rename ${name}`}
					title={`Rename ${name}`}
					onClick={() => setRenaming(true)}
				>
					<PencilIcon />
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={`Close ${name}`}
					title={`Close ${name}`}
					onClick={onClose}
				>
					<XIcon />
				</Button>
			</span>
		</div>
	);
}

/**
 * A box in place of a terminal's name, handing `onDone` what was typed on
 * Enter, or null on Escape or leaving it.
 */
export function RenameBox({
	name,
	onDone,
}: {
	name: string;
	onDone: (renamed: string | null) => void;
}): JSX.Element {
	const [value, setValue] = useState(name);
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => {
		// After the button that asked for it keeps focus from the click.
		const later = setTimeout(() => box.current?.select());
		return () => clearTimeout(later);
	}, []);
	return (
		<input
			ref={box}
			aria-label={`Rename ${name}`}
			value={value}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => onDone(null)}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					onDone(value);
				} else if (event.key === "Escape") {
					event.preventDefault();
					onDone(null);
				}
			}}
			className="mx-1 h-7 pointer-coarse:h-10 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm pointer-coarse:text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
	);
}

/**
 * A command a conversation's agent left running, nested under it, muted as a
 * subagent is. It shows only while it runs, so it needs no mark to say so.
 */
export function CommandRow({
	background,
	current,
	onOpen,
}: {
	background: Background;
	current: boolean;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			data-row
			aria-current={current ? "page" : undefined}
			title={background.command ?? background.name}
			onClick={onOpen}
			className={cn(
				"flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-3 pl-3 text-left text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			<TerminalIcon className="size-3.5 text-foreground/70" />
			<span className="min-w-0 flex-1 truncate text-muted-foreground text-sm italic">
				{background.name}
			</span>
		</button>
	);
}

/**
 * What a Tasks row shows of a task no agent is left on: it waits on you to
 * hand it to an agent or remove it.
 */
export function Orphaned(): JSX.Element {
	return (
		<span
			role="status"
			aria-label="orphaned"
			title="Orphaned: no agent is left on it"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<UnplugIcon className="size-3.5 text-foreground/60" />
		</span>
	);
}
