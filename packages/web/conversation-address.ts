import type {
	ConversationState,
	Setting,
} from "@stringsync/splates-server/conversations";
import type { AgentChoice } from "./conversation-feed";

export { openedBy, TASK } from "@stringsync/splates-server/plans/browser";

/** What `#conversations/archived` opens: every archived conversation. */
export const ARCHIVED = "archived";
/**
 * In place of an id in the address: the screen that starts a conversation,
 * with the agent after it, as `new/codex`, else as the last one started (see
 * `startsAuto` and `agentFor`), and after that the task whose tree it starts
 * in, as `new/codex/fix-upload`, else the main tree.
 */
export const NEW = "new";

/**
 * The conversation a `#conversations/<id>` address names, `ARCHIVED` for the
 * archived ones, or null.
 */
export function conversationIn(hash: string): string | null {
	const [, id] = hash.match(/^#conversations\/(.+)$/) ?? [];
	return id ?? null;
}

/**
 * After a conversation's id in the address, as `<id>/terminal`: its terminal
 * on a page of its own, as one of the main tree's is.
 */
export const TERMINAL = "/terminal";

/** The address of `conversation`'s terminal on a page of its own. */
export function terminalAddress(conversation: string): string {
	return `${conversation}${TERMINAL}`;
}

/**
 * The conversation whose terminal `open` shows on a page of its own, or null.
 * No id has a `/`, unlike the addresses of a task, a new conversation, or a
 * main-tree terminal.
 */
export function terminalOf(open: string | null): string | null {
	const [, id] = open?.match(/^([^/]+)\/terminal$/) ?? [];
	return id === undefined || ["new", "task", "terminal"].includes(id)
		? null
		: id;
}

/**
 * The address of the screen that starts a conversation with `agent`, in
 * `task`'s tree or the main tree for null, on `model` when given.
 */
export function newAddress(
	agent: string,
	task: string | null,
	model: string | null = null,
): string {
	const address = task === null ? `${NEW}/${agent}` : `${NEW}/${agent}/${task}`;
	return model === null
		? address
		: `${address}?model=${encodeURIComponent(model)}`;
}

/**
 * In place of the agent in a new conversation's address, as `new/auto`: the
 * agent is left to Auto pick, which judges the first message.
 */
export const AUTO = "auto";

/**
 * Whether `open` is the screen that starts a conversation on Auto pick: one
 * that names it, or one that names no agent when the last conversation
 * started was on Auto pick. Every way to New without naming an agent (⌥⌘N,
 * a folder's +, the screen shown after a close) asks this, with `agentFor`
 * for the agent otherwise, so the two decide what New starts on.
 */
export function startsAuto(open: string | null): boolean {
	if (open === null || pathOf(open) === NEW) {
		return lastStartedAuto();
	}
	return (
		open.startsWith(`${NEW}/`) &&
		pathOf(open)
			.slice(NEW.length + 1)
			.split("/")[0] === AUTO
	);
}

/** Where whether the last conversation started was on Auto pick is kept. */
const LAST_AUTO = "splates.newConversationAuto";

/** Whether the last conversation started was on Auto pick, so New starts there too. */
export function lastStartedAuto(): boolean {
	try {
		return localStorage.getItem(LAST_AUTO) === "true";
	} catch {
		return false;
	}
}

/** Keeps whether the conversation just started was on Auto pick, for New to follow. */
export function rememberAuto(auto: boolean): void {
	try {
		localStorage.setItem(LAST_AUTO, String(auto));
	} catch {
		// Storage refused: New starts with the newest conversation's agent.
	}
}

/** The address of the screen that starts a conversation on Auto pick, in `task`'s tree or the main tree. */
export function autoAddress(task: string | null): string {
	return task === null ? `${NEW}/${AUTO}` : `${NEW}/${AUTO}/${task}`;
}

/** Whether `open` is the screen that starts a conversation, with any agent. */
export function startsOne(open: string | null): boolean {
	return open !== null && (pathOf(open) === NEW || open.startsWith(`${NEW}/`));
}

/**
 * The agent a new conversation starts with: the one `open` names, else the
 * newest conversation's the person picked, else the newest's, else the first.
 */
export function agentFor(
	open: string | null,
	agents: AgentChoice[],
	conversations: ConversationState[],
): string {
	const named = open?.startsWith(`${NEW}/`)
		? pathOf(open)
				.slice(NEW.length + 1)
				.split("/")[0]
		: null;
	return (
		agents.find((each) => each.id === named)?.id ??
		agents.find((each) => each.id === picked(conversations)[0]?.agent)?.id ??
		agents[0]?.id ??
		""
	);
}

/** The user's saved defaults, independent of live session settings. */
export function settingsFor(
	agent: string,
	agents: AgentChoice[],
	_conversations: ConversationState[],
): Setting[] {
	return agents.find((each) => each.id === agent)?.settings ?? [];
}

/**
 * `conversations` with those started on an assignment last, since what a
 * todo assigned is no pick of the person's: those count only for an agent
 * never started otherwise.
 */
function picked(conversations: ConversationState[]): ConversationState[] {
	return [
		...conversations.filter((each) => !each.assigned),
		...conversations.filter((each) => each.assigned),
	];
}

/** The task a new conversation starts in, from `open`; null for the main tree. */
export function taskFor(open: string | null): string | null {
	return open?.startsWith(`${NEW}/`)
		? (pathOf(open)
				.slice(NEW.length + 1)
				.split("/")[1] ?? null)
		: null;
}

/** The model a new conversation starts on, `?model=` in `open`, or null. */
export function modelFor(open: string | null): string | null {
	const at = open?.indexOf("?") ?? -1;
	return open === null || at === -1
		? null
		: new URLSearchParams(open.slice(at + 1)).get("model");
}

/** `open` without its `?` and what follows. */
function pathOf(open: string): string {
	return open.split("?")[0] ?? open;
}

/** The identity of a separate new draft, or null for the original tree's draft. */
export function draftFor(open: string | null): string | null {
	const at = open?.indexOf("?") ?? -1;
	return open === null || at === -1
		? null
		: new URLSearchParams(open.slice(at + 1)).get("draft");
}

/** Keeps a new draft's identity while its agent, model or project changes. */
export function withDraft(open: string, draft: string | null): string {
	if (draft === null) {
		return open;
	}
	const [path, query] = open.split("?");
	const params = new URLSearchParams(query);
	params.set("draft", draft);
	return `${path}?${params}`;
}
