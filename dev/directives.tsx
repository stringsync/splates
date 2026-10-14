import {
	ColumnsIcon,
	GitBranchIcon,
	ListTodoIcon,
	type LucideIcon,
	SparklesIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { DIRECTIVES } from "../prompts";
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
	icon: LucideIcon;
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
				icon: ListTodoIcon,
				kind: `Todo ${argument}`,
				name: todo?.subject ?? "",
				open: todo === undefined ? undefined : () => board.open(id),
			};
		}
		case "LANE": {
			const id = Number(argument);
			return {
				icon: ColumnsIcon,
				kind: `Lane ${argument}`,
				name: board.lanes.find((each) => each.id === id)?.name ?? "",
			};
		}
		case "TASK":
			return {
				icon: GitBranchIcon,
				kind: "Task",
				name: argument,
				open: board.tasks.includes(argument)
					? () => board.openTask(argument)
					: undefined,
			};
		default:
			return {
				icon: SparklesIcon,
				kind: kind.charAt(0) + kind.slice(1).toLowerCase(),
				name: argument,
			};
	}
}

/**
 * A directive as the composer shows it: what it is about, named from the
 * board, the directive itself in its title. Given `opens`, as in a sent
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
	const { icon, kind, name, open } = about(directive, board);
	return (
		<ReferenceChip
			Icon={icon}
			kind={kind}
			name={name}
			title={directive}
			open={opens && board.linked ? open : undefined}
			inline={inline}
		/>
	);
}

/**
 * The directive about no todo, lane, or task that `text` holds and nothing
 * else, such as the checkpoint `arbor dev` sends before a restart; null for
 * any other text.
 */
export function bareDirective(text: string): string | null {
	const trimmed = text.trim();
	return BARE_DIRECTIVES.some((each) => each.directive === trimmed)
		? trimmed
		: null;
}

/**
 * A message of `directive` alone, read by `bareDirective`, as a card saying
 * what it asked of the agent, in place of the message.
 */
export function DirectiveCard({
	directive,
}: {
	directive: string;
}): JSX.Element | null {
	const bare = BARE_DIRECTIVES.find((each) => each.directive === directive);
	if (bare === undefined) {
		return null;
	}
	return (
		<CardShell
			label={bare.label.toLowerCase()}
			Icon={bare.icon}
			title={bare.label}
			tone="info"
		>
			<CardBody
				text={`Asked the agent to ${bare.about}.`}
				className="text-muted-foreground"
			/>
		</CardShell>
	);
}
