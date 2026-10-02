import { type MarkdownToJSX, Markdown as Render } from "markdown-to-jsx/react";
import type { ComponentProps, JSX } from "react";
import { cn } from "#dev/lib/utils.ts";

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

// Every level renders as the same quiet uppercase label: the documents this
// renders sit inside a card or a dialog that already carries the real title,
// so a heading here is a section marker, not a hierarchy, and a run of
// title-sized lines would shout over the content. The tag still says the
// level for a reader.
const HEADING =
	"mt-[0.9rem] mb-[0.3rem] first:mt-0 font-bold text-[0.8rem] uppercase tracking-[0.08em] opacity-55";

const heading = (tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") => ({
	component: tag,
	props: { className: HEADING },
});

/** A link opens in a new tab, so the page keeps its place. */
function Link(props: ComponentProps<"a">): JSX.Element {
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
			<Render options={OPTIONS}>{text}</Render>
		</div>
	);
}
