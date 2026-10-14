import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { CONFIG_FILE, importConfig } from "./load-config";
import { checkSystems, SYSTEMS_FILE, type SystemsFile } from "./systems";

/**
 * Moves the systems an older `arbor.config.ts` names into `arbor.systems.ts`,
 * taking the `systems` key out of the config. Does nothing when the config
 * names none. Rewrites the config only once re-importing it shows the rest of
 * it unchanged, and puts it back otherwise. Answers with the exit code to end
 * on.
 */
export async function moveSystems({
	root,
	fs,
	log,
}: {
	/** The repository's main tree. */
	root: string;
	fs: Fs;
	log: Logger;
}): Promise<number> {
	const config = await importConfig(root, fs);
	if (config.systems === undefined) {
		return 0;
	}
	const configPath = `${root}/${CONFIG_FILE}`;
	const systemsPath = `${root}/${SYSTEMS_FILE}`;
	const byHand = `move \`systems\` from ${CONFIG_FILE} into ${SYSTEMS_FILE} by hand`;
	if (await fs.exists(systemsPath)) {
		log.error(
			`both ${CONFIG_FILE} and ${SYSTEMS_FILE} name systems: ${byHand}`,
		);
		return 1;
	}
	const systems = checkSystems(`${configPath}: systems`, config.systems);

	const before = await fs.read(configPath);
	const after = withoutSystems(before);
	if (after === null) {
		log.error(
			`could not find \`systems\` to take out of ${CONFIG_FILE}: ${byHand}`,
		);
		return 1;
	}
	await fs.write(configPath, after);
	const { systems: _, ...rest } = config;
	const rewritten = await importConfig(root, fs).catch(() => null);
	if (
		rewritten === null ||
		JSON.stringify(rewritten) !== JSON.stringify(rest)
	) {
		await fs.write(configPath, before);
		log.error(
			`taking \`systems\` out of ${CONFIG_FILE} changed the rest of it: ${byHand}`,
		);
		return 1;
	}
	await fs.write(systemsPath, systemsSource(systems));
	const count = Object.keys(systems).length;
	log.info(
		`${color.green("moved")} ${count} ${count === 1 ? "system" : "systems"} from ${CONFIG_FILE} to ${SYSTEMS_FILE}`,
	);
	return 0;
}

/** An `arbor.systems.ts` that names `systems`, keys unquoted where they can be. */
export function systemsSource(systems: SystemsFile): string {
	const literal = JSON.stringify(systems, null, "\t").replace(
		/^(\s*)"([A-Za-z_$][\w$]*)":/gm,
		"$1$2:",
	);
	return `import type { SystemsFile } from "@webappwiz/arbor/systems";

export default ${literal} satisfies SystemsFile;
`;
}

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
