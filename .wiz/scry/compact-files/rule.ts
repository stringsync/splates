import type { Finding, Rule, SourceFile, Span, Tools } from "@webappwiz/scry";

/** Every line of a file, empty ones included. */
const LINE = /^.*$/gm;

/** A test, which checks logic rather than holding it. */
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Finds the line of code that takes a file of logic to its limit. */
export default class CompactFiles implements Rule {
	static readonly description =
		"A file of logic has fewer lines of code than the limit, not counting comments, blank lines or tests.";
	static readonly files = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}";
	static readonly level = "error";
	static readonly options = { limit: 500 };

	constructor(
		_tools?: Tools,
		private readonly options = CompactFiles.options,
	) {}

	async check(file: SourceFile): Promise<Finding[]> {
		if (TEST.test(file.path)) {
			return [];
		}
		const { limit } = this.options;
		const code = this.linesOfCode(file);
		const last = code[limit - 1];
		if (last === undefined) {
			return [];
		}
		return [
			last.flag(
				`This file has ${code.length} lines of code, and a file stays under ${limit}. Move out a responsibility it holds, into a file named for what that does; never numbered parts or a helpers file. When the file does one thing, excuse it with scry-ignore-file and why.`,
			),
		];
	}

	/** Each line with anything on it but whitespace and comments. */
	private linesOfCode(file: SourceFile): Span[] {
		const lines = file.lines;
		for (const comment of file.ts.findAll({ rule: { kind: "comment" } })) {
			const parts = comment.text.split("\n");
			parts.forEach((part, index) => {
				const at = comment.line - 1 + index;
				lines[at] = withoutComment(lines[at] ?? "", part, index, parts.length);
			});
		}
		return file
			.matches(LINE)
			.filter((line) => lines[line.line - 1]?.trim() !== "");
	}
}

/**
 * A line with its part of a comment taken out. A comment's first line ends
 * its line, its last starts its line, and any between fill theirs; one on a
 * single line can sit anywhere in it.
 */
function withoutComment(
	line: string,
	part: string,
	index: number,
	count: number,
): string {
	if (count === 1) {
		return line.replace(part, "");
	}
	if (index === 0) {
		return line.slice(0, line.lastIndexOf(part));
	}
	if (index === count - 1) {
		return line.slice(part.length);
	}
	return "";
}
