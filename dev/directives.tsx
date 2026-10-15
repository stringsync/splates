import { TreePineIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { DIRECTIVES, UNTRIAGED } from "../prompts";
import { ArborEvent, type Words } from "./arbor-event";
import { Board, type BoardContext } from "./board";
import { Dispatching } from "./dispatching";
import { outsideCode } from "./markdown";
import { ReferenceChip } from "./reference-chip";
import { BARE_DIRECTIVES } from "./references";

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
} {
	const [, kind = "", argument = ""] =
		/^\[ARBOR ([A-Z]+)(?: ([^\]]+))?\]$/.exec(directive) ?? [];
	const to = HANDOFF_TO.exec(directive);
	if (to !== null) {
		return { kind: "Hand off to", name: to.slice(1).filter(Boolean).join(" ") };
	}
	switch (kind) {
		case "TODO": {
			const id = Number(argument.replace("#", ""));
			const todo = board.todos.find((each) => each.id === id);
			return {
				kind: `Todo ${argument}`,
				name: todo?.subject ?? "",
				open: todo === undefined ? undefined : () => board.open(id),
			};
		}
		case "LANE": {
			if (argument === UNTRIAGED) {
				return { kind: "Untriaged", name: "" };
			}
			const id = Number(argument);
			return {
				kind: `Lane ${argument}`,
				name: board.lanes.find((each) => each.id === id)?.name ?? "",
			};
		}
		// A report names the task that stopped.
		case "TASK":
		case "HANDOFF":
		case "REPORT":
		case "IDLE":
		case "STOPPED":
			return {
				kind: "Task",
				name: argument,
				open: board.tasks.includes(argument)
					? () => board.openTask(argument)
					: undefined,
			};
		default:
			return {
				kind: kind.charAt(0) + kind.slice(1).toLowerCase(),
				name: argument,
			};
	}
}

/**
 * A directive as the composer shows it: under the tree-pine every directive
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
	const { kind, name, open } = about(directive, board);
	return (
		<ReferenceChip
			Icon={TreePineIcon}
			kind={kind}
			name={name}
			title={directive}
			open={opens && board.linked ? open : undefined}
			inline={inline}
		/>
	);
}

/** The page asking an agent to hand its task off: the agent, and any model. */
const HANDOFF_TO = /^\[ARBOR HANDOFF TO (\S+)(?: (\S+))?\]$/;

/**
 * A todo, lane, or task directive, a task handed off, or the report of a
 * task handed out, of its agent gone quiet, or of its agent terminated, which
 * a message of it alone shows as a card.
 */
const CARDED =
	/^\[ARBOR (TODO|LANE|TASK|HANDOFF|REPORT|IDLE|STOPPED) (#\d+|\d+|[^\]\s]+)\]$/;

/**
 * The directive that `text` holds and nothing else, when it is one a card
 * shows: one about no todo, lane, or task, such as the checkpoint `arbor dev`
 * sends before a restart or the merge a review's Merge button sends, or one handing the agent a todo, a lane, or a task;
 * null for any other text.
 */
export function soleDirective(text: string): string | null {
	const trimmed = text.trim();
	return BARE_DIRECTIVES.some((each) => each.directive === trimmed) ||
		CARDED.test(trimmed) ||
		HANDOFF_TO.test(trimmed)
		? trimmed
		: null;
}

/**
 * Whether a message of `directive` alone shows nothing: the report of a task
 * handed out, which the orchestrator's next lane report says all of.
 */
export function unshown(directive: string): boolean {
	return CARDED.exec(directive)?.[1] === "REPORT";
}

/**
 * A message of `directive` alone, read by `soleDirective`, as one of arbor's
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
	return words === null ? null : <ArborEvent event={{ words, at }} />;
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
	switch (kind) {
		case undefined:
		// The orchestrator's Working card that answers it says what came of the task.
		case "REPORT":
			return null;
		case "STOPPED":
			return ["Terminated", { kind: "task", task: argument }];
		case "IDLE":
			return ["Idle", { kind: "task", task: argument }];
		case "TASK":
			return ["Task", { kind: "task", task: argument }];
		case "HANDOFF":
			return ["Handoff", { kind: "task", task: argument }];
		case "TODO": {
			const id = Number(argument.replace("#", ""));
			const todo = board.todos.find((each) => each.id === id);
			return ["Todo", { kind: "todo", id, subject: todo?.subject ?? "" }];
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
