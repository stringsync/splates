/**
 * `source` typed by a type-only import of `ConfigFile` and `satisfies` rather
 * than by calling `defineConfig`, so a reader can import it without splates
 * installed; or null unless it imports `defineConfig` alone and calls it
 * once.
 */
export function typedConfig(source: string): string | null {
	const imported = source.match(DEFINE_CONFIG_IMPORT);
	const code = [...codeOf(source)];
	const calls = code.filter(
		({ index }, at) =>
			source.startsWith("defineConfig(", index) &&
			!/[\w$.]/.test(source[code[at - 1]?.index ?? -1] ?? ""),
	);
	if (imported?.index === undefined || calls.length !== 1) {
		return null;
	}
	const from = imported.index;
	const [call] = calls as [Code];
	const open = call.index + "defineConfig".length;
	const close = code.find(
		({ index, depth }) =>
			index > open && source[index] === ")" && depth === call.depth,
	);
	if (close === undefined) {
		return null;
	}
	return (
		source.slice(0, from) +
		'import type { ConfigFile } from "@stringsync/splates-server/config";' +
		source.slice(from + imported[0].length, call.index) +
		source.slice(open + 1, close.index).trim() +
		" satisfies ConfigFile" +
		source.slice(close.index + 1)
	);
}

/** An import of `defineConfig` alone from splates's config. */
const DEFINE_CONFIG_IMPORT =
	/import\s*\{\s*defineConfig\s*\}\s*from\s*["'](?:@stringsync\/)?splates(?:-server)?\/config["'];?/;

/**
 * One character of code, or the start of a string: anything not inside a
 * string, template text or comment.
 */
interface Code {
	index: number;
	/** How many brackets of any kind are open around it. */
	depth: number;
}

/**
 * Each character of `source` that is code, and the start of each string, with
 * the brackets open around it.
 * A closing bracket counts at the depth outside it, an opening one at the
 * depth inside.
 */
function* codeOf(source: string): Generator<Code> {
	// `{`, `(`, `[`, or "${" for code inside a template.
	const open: string[] = [];
	let i = 0;
	let template = false;
	while (i < source.length) {
		const char = source[i] as string;
		if (template) {
			if (char === "\\") {
				i += 2;
			} else if (char === "`") {
				template = false;
				i++;
			} else if (source.startsWith("${", i)) {
				open.push("${");
				template = false;
				i += 2;
			} else {
				i++;
			}
			continue;
		}
		if (source.startsWith("//", i)) {
			const end = source.indexOf("\n", i);
			i = end === -1 ? source.length : end;
		} else if (source.startsWith("/*", i)) {
			const end = source.indexOf("*/", i + 2);
			i = end === -1 ? source.length : end + 2;
		} else if (char === '"' || char === "'") {
			yield { index: i, depth: open.length };
			i++;
			while (i < source.length && source[i] !== char) {
				i += source[i] === "\\" ? 2 : 1;
			}
			i++;
		} else if (char === "`") {
			template = true;
			i++;
		} else if (char === "}" && open.at(-1) === "${") {
			open.pop();
			template = true;
			i++;
		} else {
			if ("{([".includes(char)) {
				open.push(char);
			} else if ("})]".includes(char)) {
				open.pop();
			}
			yield { index: i, depth: open.length };
			i++;
		}
	}
}
