import type { JSX, ReactNode } from "react";

export interface MarkdownProps {
	text: string;
	/** Added to the wrapping `<div>`, for margins and the like. */
	className?: string;
}

/**
 * Renders markdown: headings, bullet and checklist items, fenced code and
 * prose, with inline code, emphasis and http links.
 *
 * ponytail: parses the common shape rather than the whole of CommonMark, since
 * the repo carries no runtime dependencies and every document it renders is
 * agent-written. Lists are flat, so a nested item renders as a sibling, and
 * anything unrecognised renders as its own text: nothing is lost, only left
 * plain. Reach for `react-markdown` if a document here ever needs tables or
 * nesting.
 */
export function Markdown({ text, className }: MarkdownProps): JSX.Element {
	return (
		<div className={className}>
			{blocks(text).map((block) => (
				<Block key={block.line} block={block} />
			))}
		</div>
	);
}

/** One parsed block, tagged with the 0-based source line it opened on. */
type Block =
	| { kind: "heading"; line: number; level: number; text: string }
	| { kind: "list"; line: number; items: Item[] }
	| { kind: "code"; line: number; code: string }
	| { kind: "para"; line: number; text: string };

interface Item {
	line: number;
	text: string;
	/** Null for a plain bullet, otherwise whether its box is ticked. */
	checked: boolean | null;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^\s*[-*]\s+(?:\[([ xX])\]\s*)?(.*)$/;
const FENCE = /^\s*(?:```|~~~)/;

function blocks(text: string): Block[] {
	const out: Block[] = [];
	let para: { line: number; lines: string[] } | null = null;
	let list: { line: number; items: Item[] } | null = null;
	let code: { line: number; lines: string[] } | null = null;

	const endPara = (): void => {
		if (para !== null) {
			out.push({ kind: "para", line: para.line, text: para.lines.join(" ") });
			para = null;
		}
	};
	const endList = (): void => {
		if (list !== null) {
			out.push({ kind: "list", line: list.line, items: list.items });
			list = null;
		}
	};
	const endCode = (): void => {
		if (code !== null) {
			out.push({ kind: "code", line: code.line, code: code.lines.join("\n") });
			code = null;
		}
	};
	const endBlock = (): void => {
		endPara();
		endList();
	};

	for (const [at, line] of text.split("\n").entries()) {
		if (code !== null) {
			if (FENCE.test(line)) {
				endCode();
			} else {
				code.lines.push(line);
			}
			continue;
		}
		if (FENCE.test(line)) {
			endBlock();
			code = { line: at, lines: [] };
			continue;
		}
		if (line.trim() === "") {
			endBlock();
			continue;
		}
		const heading = line.match(HEADING);
		if (heading) {
			endBlock();
			out.push({
				kind: "heading",
				line: at,
				level: (heading[1] ?? "#").length,
				text: heading[2] ?? "",
			});
			continue;
		}
		const item = line.match(ITEM);
		if (item) {
			endPara();
			list ??= { line: at, items: [] };
			list.items.push({
				line: at,
				text: item[2] ?? "",
				checked: item[1] === undefined ? null : item[1] !== " ",
			});
			continue;
		}
		// A plain line under a list item belongs to it: agents wrap long items, and
		// letting one start a paragraph spills it out past the bullet.
		const open = list?.items.at(-1);
		if (open !== undefined) {
			open.text = `${open.text} ${line.trim()}`;
			continue;
		}
		para ??= { line: at, lines: [] };
		para.lines.push(line.trim());
	}
	// An unclosed fence still had content worth showing, minus the blank lines
	// between its last line and the end of the document.
	while (code !== null && (code.lines.at(-1) ?? "x").trim() === "") {
		code.lines.pop();
	}
	endCode();
	endBlock();
	return out;
}

// Every level renders as the same quiet uppercase label: the documents this
// renders sit inside a card that already carries the real title, so a heading
// here is a section marker, not a hierarchy, and a run of title-sized lines
// would shout over the content. The tag still says the level for a reader.
const HEADING_STYLE =
	"mt-[0.9rem] mb-[0.3rem] first:mt-0 font-bold text-[0.8rem] uppercase tracking-[0.08em] opacity-55";

function Block({ block }: { block: Block }): JSX.Element {
	switch (block.kind) {
		case "heading": {
			// The regex clamps the level to 1-6, so the tag is always a real one.
			const Tag = `h${block.level}` as "h1";
			return <Tag className={HEADING_STYLE}>{inline(block.text)}</Tag>;
		}
		case "list":
			return (
				<ul className="my-1 list-disc pl-5">
					{block.items.map((item) => (
						<ListItem key={item.line} item={item} />
					))}
				</ul>
			);
		case "code":
			return (
				<pre className="my-2 overflow-x-auto rounded bg-current/8 p-3 text-xs">
					<code>{block.code}</code>
				</pre>
			);
		case "para":
			return <p className="my-1">{inline(block.text)}</p>;
	}
}

function ListItem({ item }: { item: Item }): JSX.Element {
	if (item.checked === null) {
		return <li>{inline(item.text)}</li>;
	}
	return (
		// A checklist item gives up its bullet to the box and pulls back into the
		// space that left. A ticked box says done on its own, so its text is dimmed
		// rather than struck through: a long done section of strikethrough is a wall
		// nobody reads.
		<li className={`-ml-5 list-none ${item.checked ? "opacity-50" : ""}`}>
			<input
				type="checkbox"
				checked={item.checked}
				disabled
				className="mr-1.5 align-[-0.1em]"
			/>
			{inline(item.text)}
		</li>
	);
}

// http(s) only for links: every document here is agent-written, and a link is
// the one construct that would otherwise let a scheme like `javascript:` in.
const INLINE =
	/`([^`]+)`|\*\*([^*]+)\*\*|(?<![*\w])\*([^*\n]+)\*(?!\w)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** The spans of markup worth keeping. React escapes the text between them. */
function inline(text: string): ReactNode[] {
	const out: ReactNode[] = [];
	let at = 0;
	for (const match of text.matchAll(INLINE)) {
		if (match.index > at) {
			out.push(text.slice(at, match.index));
		}
		const [whole, code, strong, em, label, href] = match;
		if (code !== undefined) {
			out.push(
				<code key={match.index} className="rounded bg-current/10 px-1">
					{code}
				</code>,
			);
		} else if (strong !== undefined) {
			out.push(<strong key={match.index}>{strong}</strong>);
		} else if (em !== undefined) {
			out.push(<em key={match.index}>{em}</em>);
		} else {
			out.push(
				<a key={match.index} href={href} className="underline">
					{label}
				</a>,
			);
		}
		at = match.index + whole.length;
	}
	if (at < text.length) {
		out.push(text.slice(at));
	}
	return out;
}
