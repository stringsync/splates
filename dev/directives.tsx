import {
	ColumnsIcon,
	GitBranchIcon,
	HandshakeIcon,
	ListTodoIcon,
	type LucideIcon,
	OctagonXIcon,
	PauseIcon,
	TreePineIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { DIRECTIVES, UNTRIAGED } from "../prompts";
import { Board, type BoardContext } from "./board";
import { CardBody, CardShell } from "./card-shell";
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

/** How the card for each kind of directive in `CARDED` says what it asked. */
const CARDS = {
	TODO: { title: "Todo", Icon: ListTodoIcon, asked: "take" },
	LANE: { title: "Lane", Icon: ColumnsIcon, asked: "work down" },
	TASK: { title: "Task", Icon: GitBranchIcon, asked: "claim" },
	HANDOFF: { title: "Handoff", Icon: HandshakeIcon, asked: "take over" },
} as const satisfies Record<
	string,
	{ title: string; Icon: LucideIcon; asked: string }
>;

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
 * A message of `directive` alone, read by `soleDirective`, as a card saying
 * what it asked of the agent, in place of the message: for a todo, a lane, or
 * a task, its chip, which opens a todo still on the board or a live task.
 */
export function DirectiveCard({
	directive,
}: {
	directive: string;
}): JSX.Element | null {
	const dispatch = useContext(Dispatching)?.dispatch;
	const bare = BARE_DIRECTIVES.find((each) => each.directive === directive);
	if (bare !== undefined) {
		return (
			<CardShell
				label={bare.label.toLowerCase()}
				Icon={bare.icon}
				title={bare.label}
				tone={bare.tone}
			>
				<CardBody
					text={`Asked the agent to ${bare.about}.`}
					className="text-muted-foreground"
				/>
			</CardShell>
		);
	}
	const to = HANDOFF_TO.exec(directive);
	if (to !== null) {
		return (
			<CardShell
				label={`hand off to ${to[1]}`}
				Icon={HandshakeIcon}
				title="Hand off"
			>
				<p className="px-4 py-3.5 text-muted-foreground text-sm leading-relaxed">
					Asked the agent to hand its task off to{" "}
					<span className="font-medium text-foreground">
						{dispatch?.pickName({
							agent: to[1] as string,
							...(to[2] === undefined ? {} : { model: to[2] }),
						}) ?? to.slice(1).filter(Boolean).join(" ")}
					</span>
					.
				</p>
			</CardShell>
		);
	}
	const [, kind, argument = ""] = CARDED.exec(directive) ?? [];
	if (kind === undefined) {
		return null;
	}
	if (kind === "STOPPED") {
		return (
			<CardShell
				label={`terminated ${argument}`}
				Icon={OctagonXIcon}
				title="Terminated"
				tone="warning"
			>
				<p className="px-4 py-3.5 text-muted-foreground text-sm leading-relaxed">
					You terminated the agent on{" "}
					<DirectiveChip directive={directive} opens inline />, handed out here.
					Its task stands as it was.
				</p>
			</CardShell>
		);
	}
	if (kind === "IDLE") {
		return (
			<CardShell label={`idle ${argument}`} Icon={PauseIcon} title="Idle">
				<p className="px-4 py-3.5 text-muted-foreground text-sm leading-relaxed">
					The agent on <DirectiveChip directive={directive} opens inline />,
					handed out here, ended its turn without escalating, merging or
					removing it.
				</p>
			</CardShell>
		);
	}
	if (kind === "REPORT") {
		// The orchestrator's Working card that answers it says what came of the task.
		return null;
	}
	const { title, Icon, asked } =
		argument === UNTRIAGED
			? { title: "Lane", Icon: ColumnsIcon, asked: "triage and work down" }
			: CARDS[kind as keyof typeof CARDS];
	return (
		<CardShell
			label={`${asked} ${title.toLowerCase()} ${argument}`}
			Icon={Icon}
			title={title}
		>
			<p className="px-4 py-3.5 text-muted-foreground text-sm leading-relaxed">
				Asked the agent to {asked}{" "}
				<DirectiveChip directive={directive} opens inline />.
			</p>
		</CardShell>
	);
}
