// scry-ignore-file one-class-per-file: Section is a view Markdown hands out;
// splitting the document model across files would hide that coupling
/**
 * A markdown document you can pull data out of: frontmatter fields, sections
 * by heading, fenced code. Markdown is the glue language between humans and
 * agents, so the accessors are strict: asking for a field or section that is
 * not there throws rather than returning undefined, which is what lets a
 * caller treat a document as a data source instead of hand-rolling regexes.
 */
export class Markdown {
	private constructor(
		/** The full source text, verbatim. */
		readonly text: string,
		/** Frontmatter key/values. Empty object when there is no frontmatter. */
		readonly fields: Record<string, string>,
		/** The text after the frontmatter. */
		readonly body: string,
		/** Every heading in the document, in order, all levels. */
		readonly sections: Section[],
	) {}

	static parse(text: string): Markdown {
		const { fields, body, offset } = frontmatter(text);
		return new Markdown(text, fields, body, sections(body, offset));
	}

	/** First level-1 heading, or null when the document has none. */
	get title(): string | null {
		return (
			this.sections.find((section) => section.level === 1)?.heading ?? null
		);
	}

	/** Throws when the field is absent. */
	field(name: string): string {
		const value = this.fields[name];
		if (value === undefined) {
			throw new MarkdownError(
				`no field "${name}" (have: ${Object.keys(this.fields).join(", ") || "none"})`,
			);
		}
		return value;
	}

	has(heading: string): boolean {
		return this.find(heading) !== undefined;
	}

	/** The section under `heading` (case-insensitive). Throws when absent. */
	section(heading: string): Section {
		const found = this.find(heading);
		if (!found) {
			throw new MarkdownError(
				`no section "${heading}" (have: ${
					this.sections.map((section) => section.heading).join(", ") || "none"
				})`,
			);
		}
		return found;
	}

	private find(heading: string): Section | undefined {
		const want = heading.toLowerCase();
		return this.sections.find(
			(section) => section.heading.toLowerCase() === want,
		);
	}
}

/** Thrown when an accessor is asked for something the document does not have. */
export class MarkdownError extends Error {}

export interface CodeBlock {
	/** The fence's info string, e.g. "ts". Empty when the fence has none. */
	lang: string;
	code: string;
}

/**
 * One heading and everything under it. `body` runs until the next heading of
 * the same or a higher level, so subsections are included; `lead` stops at the
 * first child heading, so it is the section's own prose.
 */
export class Section {
	constructor(
		readonly heading: string,
		readonly level: number,
		/** 1-based line of the heading in the source document. */
		readonly line: number,
		readonly body: string,
		readonly lead: string,
	) {}

	/**
	 * Fenced code blocks, in `body` (subsections included, the default) or
	 * just this section's own `lead`.
	 */
	codeBlocks(scope: "body" | "lead" = "body"): CodeBlock[] {
		const blocks: CodeBlock[] = [];
		let fence: { mark: string; lang: string; code: string[] } | null = null;
		for (const line of this[scope].split("\n")) {
			const open = line.match(/^(```+|~~~+)\s*(\S*)/);
			if (fence === null && open) {
				fence = { mark: open[1] ?? "`", lang: open[2] ?? "", code: [] };
			} else if (
				fence !== null &&
				open &&
				open[2] === "" &&
				open[1]?.[0] === fence.mark[0]
			) {
				blocks.push({ lang: fence.lang, code: fence.code.join("\n") });
				fence = null;
			} else if (fence !== null) {
				fence.code.push(line);
			}
		}
		return blocks;
	}
}

function frontmatter(text: string): {
	fields: Record<string, string>;
	body: string;
	offset: number; // lines the frontmatter occupies, for section line numbers
} {
	const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
	if (!match) {
		return { fields: {}, body: text, offset: 0 };
	}
	const fields: Record<string, string> = {};
	// flat `key: value` scalars only, not YAML. Nested data belongs in the
	// body. Swap in a YAML parser if a real document ever needs more.
	for (const line of (match[1] ?? "").split("\n")) {
		const kv = line.match(/^(\S+):\s*(.*)$/);
		if (kv?.[1]) {
			// quoted values mean the value, as they would in YAML
			fields[kv[1]] = (kv[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
		}
	}
	return {
		fields,
		body: text.slice(match[0].length),
		offset: match[0].split("\n").length - 1,
	};
}

function sections(body: string, offset: number): Section[] {
	const lines = body.split("\n");
	const heads: { heading: string; level: number; index: number }[] = [];
	let fence: string | null = null;
	for (const [index, line] of lines.entries()) {
		const mark = line.match(/^(```+|~~~+)/)?.[1];
		if (mark) {
			// a closing fence must match the opening character
			fence = fence === null ? mark : fence[0] === mark[0] ? null : fence;
			continue;
		}
		const head = fence === null && line.match(/^(#{1,6})\s+(.*)$/);
		if (head) {
			heads.push({
				heading: (head[2] ?? "").trim(),
				level: (head[1] ?? "#").length,
				index,
			});
		}
	}
	return heads.map(({ heading, level, index }, i) => {
		const next = heads.slice(i + 1);
		const end =
			next.find((later) => later.level <= level)?.index ?? lines.length;
		const child = next.find((later) => later.index < end)?.index ?? end;
		return new Section(
			heading,
			level,
			index + offset + 1,
			lines
				.slice(index + 1, end)
				.join("\n")
				.trim(),
			lines
				.slice(index + 1, child)
				.join("\n")
				.trim(),
		);
	});
}
