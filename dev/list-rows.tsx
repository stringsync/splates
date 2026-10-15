import {
	ClipboardCheckIcon,
	MonitorIcon,
	MonitorPauseIcon,
	SquareArrowOutUpRightIcon,
	SquareTerminalIcon,
	UnplugIcon,
	XIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Duration } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import { type Need, type Needing, quietSince } from "../needs";
import type { Details } from "../show";
import { useNameOf } from "./conversation-names";
import { keyOfRow, lastTaskOfRow } from "./conversation-rows";
import { useNow } from "./hooks/use-now";
import { Mark } from "./mark";
import type { Nested } from "./parts";

/**
 * The sidebar's rows as a list, each part's under the row of the task it was
 * handed out from, in a list of its own, indented.
 */
export function Rows({
	label,
	rows,
	render,
	nested = false,
}: {
	label: string;
	rows: Nested<Needing>[];
	render: (row: Needing) => ReactNode;
	nested?: boolean;
}): JSX.Element {
	const nameOf = useNameOf();
	return (
		<ul
			aria-label={label}
			className={cn(
				"flex flex-col",
				nested && "ml-4 border-foreground/10 border-l pl-1",
			)}
		>
			{rows.map(({ row, parts }) => (
				<li key={keyOfRow(row)}>
					{render(row)}
					{parts.length > 0 && (
						<Rows
							label={`parts of ${lastTaskOfRow(row) ?? (row.conversation === null ? "" : nameOf(row.conversation))}`}
							rows={parts}
							render={render}
							nested
						/>
					)}
				</li>
			))}
		</ul>
	);
}

/** A main-tree terminal in the list, with an X that hangs up its shell. */
export function TerminalRow({
	name,
	current,
	onOpen,
	onClose,
}: {
	name: string;
	current: boolean;
	onOpen: () => void;
	onClose: () => void;
}): JSX.Element {
	return (
		<div
			className={cn(
				"group/item relative flex items-center rounded-md text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			<button
				type="button"
				data-row
				aria-current={current ? "page" : undefined}
				onClick={onOpen}
				className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-8 pl-3 text-left"
			>
				<SquareTerminalIcon className="size-3.5 text-foreground/70" />
				<span className="min-w-0 flex-1 truncate text-sm">{name}</span>
			</button>
			<Button
				size="icon-xs"
				variant="ghost"
				aria-label={`Close ${name}`}
				title={`Close ${name}`}
				className="absolute right-1 opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100"
				onClick={onClose}
			>
				<XIcon />
			</Button>
		</div>
	);
}

/**
 * A task whose agent runs outside the page, such as in Claude Code or Codex,
 * as a peer of a conversation: named for its task, and opening it alone.
 */
export function External({
	task,
	need,
	copied,
	seen,
	current,
	onOpen,
	hint = null,
	subagent = false,
}: {
	task: Details;
	need: Need;
	/** Whether the reply to its open questions was copied, to paste. */
	copied: boolean;
	/** Whether its open questions were seen, or their reply copied. */
	seen: boolean;
	current: boolean;
	onOpen: () => void;
	/** The key that opens it with ⌥⌘, while ⌥⌘ is held. */
	hint?: string | null;
	/** Whether it answers to a conversation rather than to you. */
	subagent?: boolean;
}): JSX.Element {
	const working = need.kind === "working" || need.kind === "assuming";
	const quiet = quietSince({ task, need }, useNow(working, Duration.mins(1)));
	return (
		<button
			type="button"
			data-row
			aria-current={current ? "page" : undefined}
			onClick={onOpen}
			className={cn(
				"flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			<SquareArrowOutUpRightIcon
				role="img"
				aria-label="external agent"
				className="size-3.5 text-foreground/70"
			/>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					subagent && "text-muted-foreground italic",
				)}
			>
				{task.task}
			</span>
			{hint !== null ? (
				<Kbd aria-hidden>{hint}</Kbd>
			) : need.kind === "waiting" && need.why === "abandoned" ? (
				<Abandoned />
			) : quiet !== null ? (
				<Quiet since={quiet} />
			) : working ? (
				<Elsewhere />
			) : copied ? (
				<Copied />
			) : seen ? null : (
				<Mark need={need} subagent={subagent} />
			)}
		</button>
	);
}

/**
 * What a list shows of an external agent whose questions were all answered
 * and the reply copied, in place of its alert: the page cannot tell whether
 * it was pasted, only that it is with you to.
 */
function Copied(): JSX.Element {
	return (
		<span
			role="status"
			aria-label="reply copied"
			title="Reply copied: paste it into its session"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<ClipboardCheckIcon className="size-3.5 text-foreground/60" />
		</span>
	);
}

/**
 * What a list shows of a task no agent is left on, in place of its alert: it
 * waits on you to take it up or remove it, whatever its questions.
 */
function Abandoned(): JSX.Element {
	return (
		<span
			role="status"
			aria-label="abandoned"
			title="Abandoned: no agent is left on it"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<UnplugIcon className="size-3.5 text-foreground/60" />
		</span>
	);
}

/**
 * What a list shows of an external agent's task with no sign of its agent
 * for a while, in place of `Elsewhere`: it may be thinking, or gone.
 */
function Quiet({ since }: { since: string }): JSX.Element {
	return (
		<span
			role="status"
			aria-label={`no sign since ${age(since)}`}
			title={`No sign of its agent for ${age(since)}`}
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<MonitorPauseIcon className="size-3.5 text-foreground/40" />
		</span>
	);
}

/**
 * What a list shows of an external agent at work, in place of a spinner: the
 * page cannot see whether it is still going, only that its task is under way
 * somewhere else, so it stays still.
 */
function Elsewhere(): JSX.Element {
	return (
		<span
			role="status"
			aria-label="working elsewhere"
			title="Working outside this page"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<MonitorIcon className="size-3.5 text-foreground/60" />
		</span>
	);
}
