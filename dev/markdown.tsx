import { type MarkdownToJSX, Markdown as Render } from "markdown-to-jsx/react";
import { type ComponentProps, type JSX, useContext } from "react";
import { cn } from "#dev/lib/utils.ts";
import { MENTION } from "../lanes";
import { Board, still } from "./board";

export interface MarkdownProps {
	text: string;
	/** Added to the wrapping `<div>`, for margins and the like. */
	className?: string;
	/**
	 * A card's two-line glimpse: every block at the size of the text around
	 * it and with no margins, so the lines that show are the content's.
	 */
	preview?: boolean;
}

/**
 * Renders markdown with markdown-to-jsx: GitHub's flavor, nesting, tables and
 * task lists included, styled to sit quietly in the page.
 */
export function Markdown({
	text,
	className,
	preview = false,
}: MarkdownProps): JSX.Element {
	return (
		<div
			className={cn(
				"min-w-0 break-words",
				preview &&
					"max-h-[2lh] overflow-hidden [&_*]:my-0 [&_*]:text-[length:inherit] [&_*]:normal-case [&_*]:tracking-normal [&_pre]:p-0 [&_pre]:bg-transparent",
				className,
			)}
		>
			<Render options={OPTIONS}>{linked(text)}</Render>
		</div>
	);
}

// Every level renders as the same quiet uppercase label: the documents this
// renders sit inside a card or a dialog that already carries the real title,
// so a heading here is a section marker, not a hierarchy, and a run of
// title-sized lines would shout over the content. The tag still says the
// level for a reader.
const HEADING =
	"mt-[0.9rem] mb-[0.3rem] first:mt-0 font-bold text-[0.8rem] uppercase tracking-[0.08em] opacity-55";

const OPTIONS: MarkdownToJSX.Options = {
	// Markup in a todo or a plan is shown as typed, never as elements.
	disableParsingRawHTML: true,
	forceBlock: true,
	overrides: {
		h1: heading("h1"),
		h2: heading("h2"),
		h3: heading("h3"),
		h4: heading("h4"),
		h5: heading("h5"),
		h6: heading("h6"),
		p: { props: { className: "my-1" } },
		ul: { props: { className: "my-1 list-disc pl-5" } },
		// A checklist item gives up its bullet to the box, and fades once ticked.
		li: {
			props: {
				className:
					"has-[>input]:-ml-5 has-[>input]:list-none has-[>input:checked]:opacity-50",
			},
		},
		ol: { props: { className: "my-1 list-decimal pl-5" } },
		blockquote: {
			props: { className: "my-1 border-l-2 pl-3 text-muted-foreground" },
		},
		pre: {
			props: {
				className: "my-2 overflow-x-auto rounded bg-current/8 p-3 text-xs",
			},
		},
		code: {
			props: {
				className:
					"rounded bg-current/10 px-1 [pre_&]:p-0 [pre_&]:bg-transparent",
			},
		},
		table: {
			props: { className: "my-2 block overflow-x-auto text-xs" },
		},
		th: { props: { className: "border px-2 py-1 text-left font-medium" } },
		td: { props: { className: "border px-2 py-1" } },
		hr: { props: { className: "my-3" } },
		a: Link,
		img: Image,
		input: Checkbox,
	},
};

function heading(tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
	return { component: tag, props: { className: HEADING } };
}

/** Where a mention of todo `#N` links to, read back by `Link`. */
const TODO_LINK = /^#todo-(\d+)$/;

/**
 * `text` with each `#N` outside code made a link to that todo, which `Link`
 * draws as one.
 */
function linked(text: string): string {
	return text
		.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
		.map((part, i) =>
			// The odd parts are the code the split kept, left as written.
			i % 2 === 1 ? part : part.replace(MENTION, "[#$1](#todo-$1)"),
		)
		.join("");
}

/**
 * A todo mentioned as `#N`: a tap opens it while it is on the list, and once
 * it is gone (merged or removed, since ids never come back) it is struck
 * through, so nobody reads it as still to do.
 */
function Mention({ id }: { id: number }): JSX.Element {
	const board = useContext(Board);
	const todo = board.todos.find((each) => each.id === id);
	if (!board.linked) {
		return <span>#{id}</span>;
	}
	if (todo === undefined) {
		return (
			<span
				title={`#${id} is no longer on the list: merged or removed`}
				className="text-muted-foreground line-through"
			>
				#{id}
			</span>
		);
	}
	return (
		<button
			type="button"
			{...still}
			onClick={(event) => {
				event.stopPropagation();
				board.open(id);
			}}
			title={todo.subject}
			className="relative cursor-pointer font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid"
		>
			#{id}
		</button>
	);
}

/** A link opens in a new tab, so the page keeps its place. */
function Link(props: ComponentProps<"a">): JSX.Element {
	const mention = TODO_LINK.exec(props.href ?? "");
	if (mention) {
		return <Mention id={Number(mention[1])} />;
	}
	return (
		<a
			{...props}
			target="_blank"
			rel="noreferrer noopener"
			className="break-all underline"
		/>
	);
}

/**
 * An image reads as its alt text: the paths agents write are files on their
 * machine, which the page has no way to load.
 */
function Image({ alt }: ComponentProps<"img">): JSX.Element {
	return <span className="text-muted-foreground">[{alt || "image"}]</span>;
}

/** A checklist box only reports: the document is the agent's to tick. */
function Checkbox(props: ComponentProps<"input">): JSX.Element {
	return (
		<input {...props} disabled className="mr-1.5 align-[-0.1em]" readOnly />
	);
}
