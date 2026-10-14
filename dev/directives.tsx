import {
	ColumnsIcon,
	GitBranchIcon,
	ListTodoIcon,
	type LucideIcon,
	TreePineIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { DIRECTIVES, UNTRIAGED } from "../prompts";
import { Board, type BoardContext } from "./board";
import { CardBody, CardShell } from "./card-shell";
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
		case "TASK":
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

/** A todo, lane, or task directive, which a message of it alone shows as a card. */
const CARDED = /^\[ARBOR (TODO|LANE|TASK) (#\d+|\d+|[^\]\s]+)\]$/;

/** How the card for each kind of directive in `CARDED` says what it asked. */
const CARDS = {
	TODO: { title: "Todo", Icon: ListTodoIcon, asked: "take" },
	LANE: { title: "Lane", Icon: ColumnsIcon, asked: "work down" },
	TASK: { title: "Task", Icon: GitBranchIcon, asked: "claim" },
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
		CARDED.test(trimmed)
		? trimmed
		: null;
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
	const [, kind, argument = ""] = CARDED.exec(directive) ?? [];
	if (kind === undefined) {
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
