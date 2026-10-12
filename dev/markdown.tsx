import { ArchiveIcon } from "lucide-react";
import { type MarkdownToJSX, Markdown as Render } from "markdown-to-jsx/react";
import { type ComponentProps, type JSX, useContext } from "react";
import { cn } from "#dev/lib/utils.ts";
import { MENTION } from "../lanes";
import { Board, still } from "./board";
import { GROUP } from "./lightbox";
import { Alt, Media } from "./media";

export interface MarkdownProps {
	text: string;
	/** Added to the wrapping `<div>`, for margins and the like. */
	className?: string;
	/**
	 * A card's two-line glimpse: every block at the size of the text around
	 * it and with no margins, so the lines that show are the content's.
	 */
	preview?: boolean;
	/**
	 * One line within other text, as a question's subject or a choice: its
	 * emphasis, code and links, but no paragraph, in a `<span>`.
	 */
	inline?: boolean;
	/**
	 * Links drawn as their text, for markdown inside a control such as a
	 * button, where a link would be one control inside another.
	 */
	unlinked?: boolean;
}

/**
 * Renders markdown with markdown-to-jsx: GitHub's flavor, nesting, tables and
 * task lists included, styled to sit quietly in the page.
 */
export function Markdown({
	text,
	className,
	preview = false,
	inline = false,
	unlinked = false,
}: MarkdownProps): JSX.Element {
	if (inline) {
		return (
			<span className={cn("min-w-0 break-words", className)}>
				<Render options={unlinked ? UNLINKED : INLINE}>
					{linkMentions(text)}
				</Render>
			</span>
		);
	}
	// The lightbox steps through the screenshots of one document.
	return (
		<div
			{...{ [GROUP]: "" }}
			className={cn(
				"min-w-0 break-words",
				preview &&
					"max-h-[2lh] overflow-hidden [&_*]:my-0 [&_*]:text-[length:inherit] [&_*]:normal-case [&_*]:tracking-normal [&_pre]:p-0 [&_pre]:bg-transparent",
				className,
			)}
		>
			<Render options={preview ? GLIMPSE : OPTIONS}>
				{linkMentions(text)}
			</Render>
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

/** A card's glimpse names its images rather than squeezing them into two lines. */
const GLIMPSE: MarkdownToJSX.Options = {
	...OPTIONS,
	overrides: { ...OPTIONS.overrides, img: Alt },
};

/** One line within other text, wrapped in nothing of its own. */
const INLINE: MarkdownToJSX.Options = {
	...OPTIONS,
	forceBlock: false,
	forceInline: true,
	wrapper: null,
};

/** One line inside a control, its links and mentions as plain text. */
const UNLINKED: MarkdownToJSX.Options = {
	...INLINE,
	overrides: { ...OPTIONS.overrides, a: Unlinked },
};

function heading(tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
	return { component: tag, props: { className: HEADING } };
}

/** Where a mention of todo `#N` links to, read back by `mentionIn`. */
const TODO_LINK = /^#todo-(\d+)$/;

/**
 * `text` with each `#N` outside code made a link to that todo, which a link
 * drawn through `mentionIn` shows as a `Mention`.
 */
export function linkMentions(text: string): string {
	return text
		.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
		.map((part, i) =>
			// The odd parts are the code the split kept, left as written.
			i % 2 === 1 ? part : part.replace(MENTION, "[#$1](#todo-$1)"),
		)
		.join("");
}

/**
 * Plain `text`, as the person typed it, with each `#N` in it a `Mention`.
 */
export function Mentioned({ text }: { text: string }): JSX.Element {
	// Split on the mention's own group, so the odd parts are the ids.
	const parts = text.split(new RegExp(MENTION.source));
	return (
		<>
			{parts.map((part, i) =>
				i % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: the parts never move
					<Mention key={i} id={Number(part)} />
				) : (
					part
				),
			)}
		</>
	);
}

/** The todo a link written by `linkMentions` mentions, or null for another. */
export function mentionIn(href: string | undefined): number | null {
	const mention = TODO_LINK.exec(href ?? "");
	return mention ? Number(mention[1]) : null;
}

/**
 * A todo mentioned as `#N`: a tap opens it while it is on the list, and once
 * it is gone (merged or removed, since ids never come back) it is archived,
 * struck through beside an archive box, so nobody reads it as still to do.
 */
export function Mention({ id }: { id: number }): JSX.Element {
	const board = useContext(Board);
	const todo = board.todos.find((each) => each.id === id);
	if (!board.linked) {
		return <span>#{id}</span>;
	}
	if (todo === undefined) {
		return (
			<span
				title={`#${id} is archived: merged or removed`}
				className="inline-flex items-baseline gap-0.5 text-muted-foreground"
			>
				<ArchiveIcon aria-hidden className="size-3 self-center" />
				<span className="line-through">#{id}</span>
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
	const mention = mentionIn(props.href);
	if (mention !== null) {
		return <Mention id={mention} />;
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

/** A link's text alone, as a link cannot sit inside another control. */
function Unlinked({ children }: ComponentProps<"a">): JSX.Element {
	return <span>{children}</span>;
}

/** An image shows what it names, when that is a file arbor holds. */
function Image({ src, alt }: ComponentProps<"img">): JSX.Element {
	return <Media src={src} alt={alt} />;
}

/** A checklist box only reports: the document is the agent's to tick. */
function Checkbox(props: ComponentProps<"input">): JSX.Element {
	return (
		<input {...props} disabled className="mr-1.5 align-[-0.1em]" readOnly />
	);
}
