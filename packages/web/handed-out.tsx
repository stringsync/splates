import type {
	ConversationState,
	Tool,
} from "@stringsync/splates-server/conversations";
import { GitBranchIcon, LockIcon } from "lucide-react";
import { createContext, type JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { useNameOf } from "./conversation-names";
import { bleed } from "./error-banner";

/**
 * Every conversation the page holds, archived ones too: which agents a
 * conversation started, and which one a subagent's task was added from.
 * Provided once, over every list and thread.
 */
export const Held = createContext<readonly ConversationState[]>([]);

/**
 * In place of a composer, for a subagent whose harness started it under
 * conversation `by`: it takes words only from that one, so it names that one
 * and its task, and what `by` asked it to run as, read-only.
 */
export function SubagentComposer({
	task,
	by,
	onOpen,
}: {
	/** The subagent's task. */
	task: string;
	by: ConversationState;
	onOpen: (id: string) => void;
}): JSX.Element {
	const call = subagentCall(task, by);
	return (
		<ReadOnlyComposer
			label="subagent"
			lead="A subagent of"
			by={by}
			onOpen={onOpen}
			picked={
				call === null
					? ""
					: [
							call.title,
							call.subagent?.type ?? "general-purpose",
							call.subagent?.model ?? SUBAGENT_MODEL,
						].join(" · ")
			}
		/>
	);
}

/** What a subagent's model reads as when the call that started it names none. */
export const SUBAGENT_MODEL = "default model";

/**
 * The tool call in `caller` that started the subagent which added `task`:
 * the parent of the `splates add` it ran there. Null when `caller` holds no
 * such call, as for a log too old to say which one it ran under.
 */
export function subagentCall(
	task: string,
	caller: ConversationState,
): Tool | null {
	const tools = caller.messages.flatMap((message) =>
		message.parts.filter((part): part is Tool => part.type === "tool"),
	);
	const added = tools.find(
		(each) =>
			each.parent !== null &&
			each.command !== null &&
			addsTask(each.command, task),
	);
	return added === undefined
		? null
		: (tools.find((each) => each.id === added.parent) ?? null);
}

/** Whether `command` runs `splates add <task>`. */
function addsTask(command: string, task: string): boolean {
	for (const [, added] of command.matchAll(
		/\bsplates\s+add\s+["']?([^\s"']+)/g,
	)) {
		if (added === task) {
			return true;
		}
	}
	return false;
}

/**
 * What stands in a read-only conversation's composer: the one it answers to,
 * with its task, where the person talks to it, and below, what the
 * composer's row would show, `picked` and `meter`, read-only.
 */
function ReadOnlyComposer({
	label,
	lead,
	by,
	onOpen,
	picked,
}: {
	label: string;
	/** The words before `by`'s name. */
	lead: string;
	by: ConversationState;
	onOpen: (id: string) => void;
	picked: string;
}): JSX.Element {
	const nameOf = useNameOf();
	const task = by.task ?? by.lastTask;
	const name = nameOf(by);
	return (
		<div
			role="note"
			aria-label={label}
			className="flex flex-col gap-1 rounded-[var(--composer-radius,1rem)] border px-4 py-3 text-muted-foreground text-sm"
		>
			<div className="flex items-center gap-3">
				<p className="flex-1">
					{lead}{" "}
					<Button
						variant="link"
						className="h-auto p-0 font-medium"
						onClick={() => onOpen(by.id)}
					>
						{name}
					</Button>
					{/* Unnamed, it goes by its task already. */}
					{task !== null && task !== name && (
						<>
							{" "}
							on{" "}
							<span className="inline-flex items-baseline gap-1 font-medium text-foreground">
								<GitBranchIcon
									aria-hidden
									className="size-3 shrink-0 self-center"
								/>
								{task}
							</span>
						</>
					)}
					, which it reports to. Talk to it there.
				</p>
			</div>
			<div className="flex min-w-0 items-center gap-1 text-xs empty:hidden">
				{picked !== "" && <span className="truncate">{picked}</span>}
			</div>
		</div>
	);
}

/**
 * Atop a conversation that answers to `by`, across the pane's padding to its
 * edges as the archived banner is: the page writes nothing to it.
 */
export function ReadOnlyBanner({
	by,
	phone,
}: {
	by: ConversationState;
	phone: boolean;
}): JSX.Element {
	const nameOf = useNameOf();
	return (
		<p
			role="status"
			className={cn(
				bleed(phone),
				"flex shrink-0 items-center justify-center gap-2 border-b bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<LockIcon className="size-4 shrink-0" />
			<span>
				<span className="font-medium text-foreground">
					This conversation is read-only.
				</span>{" "}
				Only {nameOf(by)} writes to it.
			</span>
		</p>
	);
}
