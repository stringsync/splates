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
import { Board } from "./board";

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

/** What a directive is about, as its chip names it. */
function about(
	directive: string,
	board: {
		todos: { id: number; subject: string }[];
		lanes: { id: number; name: string }[];
	},
): { icon: LucideIcon; kind: string; name: string } {
	const [, kind = "", argument = ""] =
		/^\[ARBOR ([A-Z]+)(?: ([^\]]+))?\]$/.exec(directive) ?? [];
	switch (kind) {
		case "TODO": {
			const id = Number(argument.replace("#", ""));
			return {
				icon: ListTodoIcon,
				kind: `Todo ${argument}`,
				name: board.todos.find((each) => each.id === id)?.subject ?? "",
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
			return { icon: GitBranchIcon, kind: "Task", name: argument };
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
 * board, the directive itself in its title.
 */
export function DirectiveChip({
	directive,
	children,
}: {
	directive: string;
	/** Its remove button. */
	children?: JSX.Element | undefined;
}): JSX.Element {
	const board = useContext(Board);
	const { icon: Icon, kind, name } = about(directive, board);
	return (
		<span
			title={directive}
			className="flex h-7 max-w-80 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 ps-2 pe-1 text-primary text-xs"
		>
			<Icon aria-hidden className="size-3.5 shrink-0" />
			<span className="shrink-0 font-medium">{kind}</span>
			{name !== "" && (
				<span className="min-w-0 truncate text-foreground/80">{name}</span>
			)}
			{children}
		</span>
	);
}
