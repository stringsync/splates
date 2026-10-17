import { GitBranchIcon, LockIcon, OctagonXIcon } from "lucide-react";
import { createContext, type JSX, type ReactNode, useContext } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState, Setting, Tool } from "../conversations";
import { AskPanel } from "./ask-panel";
import { touchButton } from "./board";
import { terminateConversation } from "./conversation-api";
import { useNameOf } from "./conversation-names";
import type { Drafts } from "./drafts";
import { bleed } from "./error-banner";
import { Refusal, useRefusal } from "./refusal";
import { ContextMeter } from "./usage";

/**
 * Every conversation the page holds, archived ones too: what tells whether one
 * answers to another, so is read-only here, and which agents one handed tasks
 * to. Provided once, over every list and thread.
 */
export const Held = createContext<readonly ConversationState[]>([]);

/**
 * The conversation `conversation` answers to, while it is there: it handed
 * `conversation` its task, so the page writes nothing to `conversation`, and
 * every control that would shows its read-only variant. Null for one the
 * person talks to, or once the one it answered to is gone, so it is never
 * stranded.
 */
export function useHandedOutBy(
	conversation: ConversationState,
): ConversationState | null {
	return handedOutBy(conversation, useContext(Held));
}

/**
 * Whether the conversation `id` answers to another, so every control that
 * would write to it shows its read-only variant.
 */
export function useReadOnly(id: string): boolean {
	const held = useContext(Held);
	const conversation = held.find((each) => each.id === id);
	return conversation !== undefined && handedOutBy(conversation, held) !== null;
}

/** What `useHandedOutBy` reads, from the conversations in `held`. */
export function handedOutBy(
	conversation: ConversationState,
	held: readonly ConversationState[],
): ConversationState | null {
	const { handedBy } = conversation;
	return handedBy === null
		? null
		: (held.find((each) => each.id === handedBy) ?? null);
}

/** The conversations `conversation` handed tasks to, oldest first. */
export function useHandedTo(
	conversation: ConversationState,
): ConversationState[] {
	return useContext(Held).filter((each) => each.handedBy === conversation.id);
}

/**
 * In place of the composer of a conversation another handed its task to:
 * the agent answers to that one, so its questions and reviews go there, and
 * the person talks to it there. Terminate is the way out, stopping the agent
 * and telling that one, which decides what becomes of the task. What the
 * composer's row would show, its model, effort and context, it shows read-only:
 * that one picked them.
 */
export function HandedOut({
	conversation,
	by,
	onOpen,
}: {
	conversation: ConversationState;
	by: ConversationState;
	onOpen: (id: string) => void;
}): JSX.Element {
	const { refusal, attempt } = useRefusal();
	const working =
		conversation.status === "starting" || conversation.status === "running";
	return (
		<ReadOnlyComposer
			label="handed out"
			lead="Handed out by"
			by={by}
			onOpen={onOpen}
			picked={settingsLine(conversation.settings)}
			action={
				working && (
					<Button
						variant="outline"
						size="sm"
						className={touchButton}
						onClick={() =>
							void attempt(
								terminateConversation(conversation.id),
								"Not terminated",
							)
						}
					>
						<OctagonXIcon data-icon="inline-start" />
						Terminate
					</Button>
				)
			}
			meter={<ContextMeter usage={conversation.usage} />}
			refusal={<Refusal refusal={refusal} className="text-right" />}
		/>
	);
}

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
 * the parent of the `arbor add` it ran there. Null when `caller` holds no
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

/** Whether `command` runs `arbor add <task>`. */
function addsTask(command: string, task: string): boolean {
	for (const [, added] of command.matchAll(
		/\barbor\s+add\s+["']?([^\s"']+)/g,
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
	action,
	meter,
	refusal,
}: {
	label: string;
	/** The words before `by`'s name. */
	lead: string;
	by: ConversationState;
	onOpen: (id: string) => void;
	picked: string;
	action?: ReactNode;
	meter?: ReactNode;
	refusal?: ReactNode;
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
				{action}
			</div>
			<div className="flex min-w-0 items-center gap-1 text-xs empty:hidden">
				{picked !== "" && <span className="truncate">{picked}</span>}
				{meter}
			</div>
			{refusal}
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

/**
 * A session's settings as the composer's pickers read: each pick by its
 * option's name, and a toggle by its own name while on.
 */
function settingsLine(settings: Setting[]): string {
	return settings
		.flatMap((setting) =>
			setting.type === "boolean"
				? setting.current === "on"
					? [setting.name]
					: []
				: [
						setting.options.find((option) => option.value === setting.current)
							?.name ?? setting.current,
					],
		)
		.join(" · ");
}

/**
 * What an agent this conversation handed a task to asks permission for,
 * shown above this one's composer: the agent answers to this one, but only
 * the person can let it run a tool, so they answer here, named by the agent.
 */
export function AgentAsk({
	drafts,
	conversation,
}: {
	drafts: Drafts;
	/** The agent's conversation, which holds the ask. */
	conversation: ConversationState;
}): JSX.Element | null {
	const nameOf = useNameOf();
	if (conversation.ask === null) {
		return null;
	}
	return (
		<AskPanel
			key={conversation.ask.id}
			drafts={drafts}
			conversation={conversation}
			agent={nameOf(conversation)}
			ask={conversation.ask}
			keys={false}
		/>
	);
}
