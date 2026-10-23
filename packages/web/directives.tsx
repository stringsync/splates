import type { ThreadMessageLike } from "@assistant-ui/react";
import { SERVER_TOLD } from "@stringsync/splates-server/conversations/browser";
import {
	APPROVE,
	DIRECTIVES,
	MERGE,
	UNTRIAGED,
} from "@stringsync/splates-server/plans/browser";
import { UtensilsIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Board, type BoardContext } from "./board";
import { Dispatching } from "./dispatching";
import { earlyWarningOf } from "./early-warning";
import { outsideCode } from "./markdown";
import { queueStartOf } from "./queue-start";
import { ReferenceChip } from "./reference-chip";
import { BARE_DIRECTIVES } from "./references";
import { SplatesEvent, type Words } from "./splates-event";

/** Where a link written by `linkDirectives` points, read back by `directiveIn`. */
const DIRECTIVE_LINK = /^#directive=(.+)$/;

/**
 * `text` with each directive outside code made a link that `directiveIn`
 * reads back, so a message draws it as its chip where it stands.
 */
export function linkDirectives(text: string): string {
	return outsideCode(text, (prose) =>
		prose.replace(
			DIRECTIVES,
			// A label with no `#` or `@`, which `linkMentions` and `linkNamed`
			// would link again.
			(directive) => `[directive](#directive=${encodeURIComponent(directive)})`,
		),
	);
}

/** The directive a link written by `linkDirectives` names, or null for another. */
export function directiveIn(href: string | undefined): string | null {
	const link = DIRECTIVE_LINK.exec(href ?? "");
	return link === null ? null : decodeURIComponent(link[1] ?? "");
}

/** Plain `text` with each directive in it an inline `DirectiveChip`. */
export function Directed({ text }: { text: string }): JSX.Element {
	// Split on a group around the directive, so the odd parts are directives.
	const parts = text.split(new RegExp(`(${DIRECTIVES.source})`));
	return (
		<>
			{parts.map((part, i) =>
				i % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: the parts never move
					<DirectiveChip key={i} directive={part} inline />
				) : (
					part
				),
			)}
		</>
	);
}

/**
 * What a directive is about, as its chip names it, and how to open it when the
 * page can: a todo still on the board, or a task.
 */
function about(
	directive: string,
	board: BoardContext,
): {
	kind: string;
	name: string;
	open?: (() => void) | undefined;
	missing?: boolean;
} {
	const [, kind = "", argument = ""] =
		/^\[(?:SPLATES|ARBOR) ([A-Z]+)(?: ([^\]]+))?\]$/.exec(directive) ?? [];
	const to = HANDOFF_TO.exec(directive);
	if (to !== null) {
		return { kind: "Hand off to", name: to.slice(1).filter(Boolean).join(" ") };
	}
	const bare = BARE_DIRECTIVES.find((each) => each.directive === directive);
	if (bare !== undefined) {
		return { kind: bare.label, name: "" };
	}
	switch (numbered(kind, argument) ? "TODO" : kind) {
		case "TODO": {
			const id = Number(argument.replace("#", ""));
			const todo = board.todos.find((each) => each.id === id);
			return {
				kind: `Task ${argument}`,
				name: todo?.subject ?? "",
				open: todo === undefined ? undefined : () => board.open(id),
			};
		}
		case "LANE": {
			if (argument === UNTRIAGED) {
				return { kind: "Untriaged", name: "" };
			}
			const id = Number(argument);
			const lane = board.lanes.find((each) => each.id === id);
			return {
				kind: `Lane ${argument}`,
				name: lane?.name ?? "",
				open: lane === undefined ? undefined : () => board.openLane(id),
				missing: board.linked && lane === undefined,
			};
		}
		// A report names the task that stopped.
		case "TASK":
		case "HANDOFF":
		case "REPORT":
		case "IDLE":
			return {
				kind: "Task",
				name: argument,
				open: () => board.openTask(argument),
			};
		default:
			return {
				kind: kind.charAt(0) + kind.slice(1).toLowerCase(),
				name: argument,
			};
	}
}

/**
 * A directive as the composer shows it: under the utensils every directive
 * chip shares, what it is about, named from the board, the directive itself
 * in its title. Given `opens`, as in a sent
 * message, a tap opens the todo or task it names; given `inline`, it sits in
 * a line of text.
 */
export function DirectiveChip({
	directive,
	opens = false,
	inline = false,
}: {
	directive: string;
	opens?: boolean;
	inline?: boolean;
}): JSX.Element {
	const board = useContext(Board);
	const { kind, name, open, missing } = about(directive, board);
	return (
		<ReferenceChip
			Icon={UtensilsIcon}
			kind={kind}
			name={name}
			title={directive}
			missing={missing}
			open={opens && board.linked ? open : undefined}
			inline={inline}
		/>
	);
}

/**
 * Whether a directive of `kind` names a task by its number, as
 * `[SPLATES TASK #N]` does, or `[SPLATES TODO #N]` from before the rename,
 * where `[SPLATES TASK <slug>]` names a started one.
 */
function numbered(kind: string, argument: string): boolean {
	return (kind === "TASK" || kind === "TODO") && argument.startsWith("#");
}

/** The page asking an agent to hand its task off: the agent, and any model. */
const HANDOFF_TO = /^\[(?:SPLATES|ARBOR) HANDOFF TO (\S+)(?: (\S+))?\]$/;

/**
 * A todo, lane, or task directive, a task handed off, or the report of a
 * task handed out, or of its agent gone quiet, which a message of it alone
 * shows as a card.
 */
const CARDED =
	/^\[(?:SPLATES|ARBOR) (TODO|LANE|TASK|HANDOFF|REPORT|IDLE) (#\d+|\d+|[^\]\s]+)\]$/;

/**
 * The directive that `text` holds and nothing else, when it is one a card
 * shows: one about no todo, lane, or task, such as the checkpoint `splates server`
 * sends before a restart or the merge a review's Merge button sends, or one handing the agent a todo, a lane, or a task;
 * null for any other text.
 */
export function soleDirective(text: string): string | null {
	const trimmed = text.trim();
	return isBare(trimmed) || CARDED.test(trimmed) || HANDOFF_TO.test(trimmed)
		? trimmed
		: null;
}

/** Whether `directive` is one about no todo, lane, or task, as a checkpoint is. */
export function isBare(directive: string): boolean {
	return BARE_DIRECTIVES.some((each) => each.directive === directive);
}

/** The directives the person sends to approve a proposal or a merge. */
const APPROVALS: ReadonlySet<string> = new Set([APPROVE, MERGE]);

/** A skill or command named alone, as the composer's `/` writes it. */
const SOLE_COMMAND = /^\/\S+$/u;

/** Whether `text` only invokes a skill or command, with nothing more. */
export function isSoleCommand(text: string): boolean {
	return SOLE_COMMAND.test(text.trim());
}

/**
 * Whether `message` is a person's message of one bare directive alone, which
 * shows as one of splates's event lines, as a checkpoint, a resume, or a merge
 * does, or of one skill or command alone, or splates server's early warning
 * (`isEarlyWarning`). It carries on the turn it comes in
 * rather than opening one, and takes none of the scroll a turn's start does,
 * so the message stuck atop that turn stays there while the reply goes on.
 */
export function carriesOn(message: ThreadMessageLike): boolean {
	if (message.role !== "user" || typeof message.content === "string") {
		return false;
	}
	const [only, ...more] = message.content;
	const files = (message.attachments ?? []).some((attachment) =>
		(attachment.content ?? []).some(
			(part) => part.type === "image" || part.type === "file",
		),
	);
	return (
		only?.type === "text" &&
		more.length === 0 &&
		!files &&
		(isBare(only.text.trim()) ||
			isSoleCommand(only.text) ||
			isEarlyWarning(only.text, message.metadata?.custom?.told))
	);
}

/**
 * Whether a message of `text` alone, from `told`, is splates server's early
 * warning to the agent, which the page draws as event lines instead.
 */
export function isEarlyWarning(text: string, told: unknown): boolean {
	return (
		told === SERVER_TOLD &&
		(earlyWarningOf(text) !== null || queueStartOf(text) !== null)
	);
}

/**
 * Whether a message of `directive` alone shows nothing: the report of a task
 * handed out, which the orchestrator's next lane report says all of.
 */
export function unshown(directive: string): boolean {
	return CARDED.exec(directive)?.[1] === "REPORT";
}

/**
 * A message of `directive` alone, read by `soleDirective`, as one of splates's
 * event lines in place of the message: the verb it asked of the agent, and
 * for a todo, a lane, or a task, its chip, which opens a todo still on the
 * board or a live task.
 */
export function DirectiveLine({
	directive,
	at = null,
}: {
	directive: string;
	/** When it was sent, as an ISO time, shown while the stamps are on. */
	at?: string | null;
}): JSX.Element | null {
	const dispatch = useContext(Dispatching)?.dispatch;
	const board = useContext(Board);
	const words = wordsOf(directive, board, (agent) => dispatch?.pickName(agent));
	return words === null ? null : (
		<SplatesEvent
			event={{
				mark: APPROVALS.has(directive) ? "approved" : null,
				words,
				at,
				title: directive,
			}}
		/>
	);
}

/**
 * What the line for `directive` says, or null for one that shows nothing.
 * `nameAgent` names the agent a handoff goes to.
 */
function wordsOf(
	directive: string,
	board: BoardContext,
	nameAgent: (agent: { agent: string; model?: string }) => string | undefined,
): Words | null {
	const bare = BARE_DIRECTIVES.find((each) => each.directive === directive);
	if (bare !== undefined) {
		return [bare.label];
	}
	const to = HANDOFF_TO.exec(directive);
	if (to !== null) {
		return [
			"Hand off to",
			nameAgent({
				agent: to[1] as string,
				...(to[2] === undefined ? {} : { model: to[2] }),
			}) ?? to.slice(1).filter(Boolean).join(" "),
		];
	}
	const [, kind, argument = ""] = CARDED.exec(directive) ?? [];
	switch (kind !== undefined && numbered(kind, argument) ? "TODO" : kind) {
		case undefined:
		// The orchestrator's Working card that answers it says what came of the task.
		case "REPORT":
			return null;
		case "IDLE":
			return ["Idle", { kind: "task", task: argument }];
		case "TASK":
			return ["Task", { kind: "task", task: argument }];
		case "HANDOFF":
			return ["Handoff", { kind: "task", task: argument }];
		case "TODO": {
			const id = Number(argument.replace("#", ""));
			const todo = board.todos.find((each) => each.id === id);
			return ["Task", { kind: "todo", id, subject: todo?.subject ?? "" }];
		}
		default: {
			if (argument === UNTRIAGED) {
				return ["Untriaged lane"];
			}
			const id = Number(argument);
			const lane = board.lanes.find((each) => each.id === id);
			return ["Lane", { kind: "lane", id, name: lane?.name ?? argument }];
		}
	}
}
