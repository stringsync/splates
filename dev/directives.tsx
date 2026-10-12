import type {
	Attachment,
	CreateAttachment,
	ThreadComposerRuntime,
} from "@assistant-ui/react";
import {
	ColumnsIcon,
	GitBranchIcon,
	ListTodoIcon,
	type LucideIcon,
	SparklesIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { leadingDirectives } from "../prompts";
import { Board, type BoardContext } from "./board";

/**
 * What a composer attachment holding an `[ARBOR ...]` directive is typed as,
 * which the attachment adapter accepts beside images.
 */
export const DIRECTIVE_TYPE = "text/vnd.arbor-directive";

/** `directive` as an attachment: no file, only its text. */
function attachment(directive: string): CreateAttachment {
	return {
		type: "directive",
		name: directive,
		contentType: DIRECTIVE_TYPE,
		content: [{ type: "text", text: directive }],
	};
}

/** The directives among `attachments`, in order. */
export function directivesOf(
	attachments: readonly Pick<Attachment, "contentType" | "name">[],
): string[] {
	return attachments
		.filter((each) => each.contentType === DIRECTIVE_TYPE)
		.map((each) => each.name);
}

/** `text` with `directives` ahead of it, the way an agent reads them. */
export function withDirectives(directives: string[], text: string): string {
	return [...directives, text].filter((each) => each !== "").join("\n\n");
}

/**
 * Lifts the directives `composer`'s text starts with into chips, leaving the
 * rest as its text. Changes nothing when it starts with none.
 */
export function liftDirectives(composer: ThreadComposerRuntime): void {
	const state = composer.getState();
	const { directives, rest } = leadingDirectives(state.text);
	if (directives.length === 0) {
		return;
	}
	const held = directivesOf(state.attachments);
	composer.setText(rest);
	for (const directive of directives) {
		if (!held.includes(directive)) {
			void composer.addAttachment(attachment(directive));
		}
	}
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
				open: () => board.openTask(argument),
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
 * message, a tap opens the todo or task it names.
 */
export function DirectiveChip({
	directive,
	opens = false,
	children,
}: {
	directive: string;
	opens?: boolean;
	/** Its remove button. */
	children?: JSX.Element | undefined;
}): JSX.Element {
	const board = useContext(Board);
	const { icon: Icon, kind, name, open } = about(directive, board);
	const inside = (
		<>
			<Icon aria-hidden className="size-3.5 shrink-0" />
			<span className="shrink-0 font-medium">{kind}</span>
			{name !== "" && (
				<span className="min-w-0 truncate text-foreground/80">{name}</span>
			)}
			{children}
		</>
	);
	const look =
		"flex h-7 max-w-80 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 ps-2 pe-1 text-primary text-xs";
	if (opens && board.linked && open !== undefined) {
		return (
			<button
				type="button"
				title={directive}
				onClick={(event) => {
					// Opens what it names, rather than the message it sits in.
					event.stopPropagation();
					open();
				}}
				className={`${look} cursor-pointer hover:bg-primary/15`}
			>
				{inside}
			</button>
		);
	}
	return (
		<span title={directive} className={look}>
			{inside}
		</span>
	);
}
