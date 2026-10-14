/**
 * `source` typed by a type-only import of `ConfigFile` and `satisfies` rather
 * than by calling `defineConfig`, so a reader can import it without arbor
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
		'import type { ConfigFile } from "@webappwiz/arbor/config";' +
		source.slice(from + imported[0].length, call.index) +
		source.slice(open + 1, close.index).trim() +
		" satisfies ConfigFile" +
		source.slice(close.index + 1)
	);
}

/** An import of `defineConfig` alone from arbor's config. */
const DEFINE_CONFIG_IMPORT =
	/import\s*\{\s*defineConfig\s*\}\s*from\s*["']@webappwiz\/arbor\/config["'];?/;

/**
 * `source` with the `systems` property of its outermost object taken out,
 * with its line when it has one to itself, or null unless there is exactly
 * one such property.
 */
export function withoutSystems(source: string): string | null {
	const code = [...codeOf(source)];
	const keys = code.filter(
		({ index, objects }, at) =>
			objects === 1 &&
			KEY.test(source.slice(index)) &&
			!/[\w$.]/.test(source[code[at - 1]?.index ?? -1] ?? ""),
	);
	if (keys.length !== 1) {
		return null;
	}
	const [key] = keys as [Code];
	const colon = source.indexOf(":", key.index);
	// The value ends at the first `,` back at the key's own depth, or the
	// `}` that closes the key's object.
	const end = code.find(
		({ index, depth }) =>
			index > colon &&
			((source[index] === "," && depth === key.depth) ||
				(source[index] === "}" && depth === key.depth - 1)),
	);
	if (end === undefined) {
		return null;
	}
	let from = key.index;
	let to = source[end.index] === "," ? end.index + 1 : end.index;
	const lineStart = source.lastIndexOf("\n", from - 1) + 1;
	const rest = source.slice(to).match(/^[ \t]*(\/\/[^\n]*)?\n/);
	if (/^\s*$/.test(source.slice(lineStart, from)) && rest !== null) {
		from = lineStart;
		to += rest[0].length;
	} else if (source[end.index] === ",") {
		to += (source.slice(to).match(/^[ \t]*/)?.[0] ?? "").length;
	}
	return source.slice(0, from) + source.slice(to);
}

/** A `systems` key, bare or quoted, with its colon. */
const KEY = /^(systems|"systems"|'systems')\s*:/;

/**
 * One character of code, or the start of a string: anything not inside a
 * string, template text or comment.
 */
interface Code {
	index: number;
	/** How many brackets of any kind are open around it. */
	depth: number;
	/** How many of those are `{`. */
	objects: number;
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
	const objects = () => open.filter((each) => each === "{").length;
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
			yield { index: i, depth: open.length, objects: objects() };
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
			yield { index: i, depth: open.length, objects: objects() };
			i++;
		}
	}
}
