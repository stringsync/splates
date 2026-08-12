const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
};

/** Text as text, safe to drop into markup or an attribute value. */
export const esc = (text: string): string =>
	text.replace(/[&<>"]/g, (char) => ENTITIES[char] ?? char);

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^\s*[-*]\s+(?:\[([ xX])\]\s*)?(.*)$/;
const FENCE = /^\s*(?:```|~~~)/;

/**
 * Markdown as HTML: headings, checklists, bullets, fenced code and prose.
 *
 * ponytail: covers the shape a TODO.md is required to have rather than the
 * whole of markdown, since that file is the only thing rendered here and the
 * repo carries no runtime dependencies. Anything outside that shape falls
 * through as escaped text, so nothing is ever lost, only left plain. Lists are
 * flat, and a nested item renders as a sibling; reach for a real parser if a
 * document here ever needs one.
 */
export function render(text: string): string {
	const out: string[] = [];
	let para: string[] = [];
	let list: string[] | null = null;
	let code: string[] | null = null;

	const endCode = (): void => {
		out.push(`<pre><code>${esc((code ?? []).join("\n"))}</code></pre>`);
		code = null;
	};
	const endPara = (): void => {
		if (para.length > 0) {
			out.push(`<p>${inline(para.join(" "))}</p>`);
		}
		para = [];
	};
	const endList = (): void => {
		if (list !== null) {
			out.push(`<ul>${list.map((item) => `${item}</li>`).join("")}</ul>`);
		}
		list = null;
	};
	const endBlock = (): void => {
		endPara();
		endList();
	};

	for (const line of text.split("\n")) {
		if (code !== null) {
			if (FENCE.test(line)) {
				endCode();
			} else {
				code.push(line);
			}
			continue;
		}
		if (FENCE.test(line)) {
			endBlock();
			code = [];
			continue;
		}
		if (line.trim() === "") {
			endBlock();
			continue;
		}
		const heading = line.match(HEADING);
		if (heading) {
			endBlock();
			// The card around this already carries the task name at h1 size, so the
			// document starts a couple of levels down instead of competing with it.
			const level = Math.min((heading[1] ?? "#").length + 2, 6);
			out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
			continue;
		}
		const item = line.match(ITEM);
		if (item) {
			endPara();
			list ??= [];
			list.push(box(item[1]) + inline(item[2] ?? ""));
			continue;
		}
		// A plain line under a list item belongs to it: agents wrap long items,
		// and letting one start a paragraph spills it out past the bullet.
		const open = list?.at(-1);
		if (list !== null && open !== undefined) {
			list[list.length - 1] = `${open} ${inline(line.trim())}`;
			continue;
		}
		para.push(line.trim());
	}
	// An unclosed fence still had content worth showing.
	if (code !== null) {
		endCode();
	}
	endBlock();
	return out.join("\n");
}

/** The open `<li>`, with a real checkbox when the item had one. */
function box(mark: string | undefined): string {
	if (mark === undefined) {
		return "<li>";
	}
	const checked = mark === " " ? "" : " checked";
	return `<li class="box"><input type="checkbox" disabled${checked}> `;
}

/** Escapes first, then puts back the few spans of markup worth keeping. */
function inline(text: string): string {
	return (
		esc(text)
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>")
			// http(s) only: everything here is written by agents, and a link is the
			// one construct that would otherwise let a scheme like `javascript:`
			// into the page.
			.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2">$1</a>`)
	);
}
