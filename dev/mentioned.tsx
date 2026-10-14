import { createContext, type JSX, use } from "react";
import type { NamedSystem } from "../systems";
import { distinctNames, FileChip } from "./file-chip";
import { outsideCode } from "./markdown";
import { SystemChip } from "./systems";

/**
 * What the tree a conversation runs in names, for drawing the `#system` and
 * `@path` mentions in its messages: its systems, its paths, as `@` lists
 * them, and where it sits, so a file opens in the editor.
 */
export interface Named {
	systems: readonly NamedSystem[];
	paths: ReadonlySet<string>;
	/** The tree's absolute path; null until it is known. */
	tree: string | null;
	/** Whether the paths and the systems are still on their way. */
	resolving: { paths: boolean; systems: boolean };
}

export const NamedContext = createContext<Named>({
	systems: [],
	paths: new Set(),
	tree: null,
	resolving: { paths: false, systems: false },
});

/** A `#` or `@` at the start or after a space, and what follows it. */
export const NAMING = /(^|\s)([#@])([^\s#@]+)/g;

/** What a sentence may put after a mention, which is not part of it. */
const TRAILING = /[.,;:!?)\]'"]+$/;

/** Where a link written by `linkNamed` points, read back by `namedIn`. */
const NAMED_LINK = /^#(system|file)=([^&]+)(?:&name=(.+))?$/;

/**
 * `text` with each `#name` naming one of `named`'s systems, by its name or an
 * alias, and each `@path` naming one of its files or directories, outside
 * code, made a link that `namedIn` reads back. A mention that names nothing,
 * such as `#12` or a path not in the tree, is left alone.
 */
export function linkNamed(
	text: string,
	named: Pick<Named, "systems" | "paths">,
): string {
	const names = distinctNames(filesIn(text, named));
	return outsideCode(text, (prose) =>
		prose.replace(NAMING, (whole, before: string, sign: string, called) => {
			const found = reading(named, sign, called);
			if (found === undefined) {
				return whole;
			}
			const label = `${sign}${found.as}`.replace(/[[\]\\]/g, "\\$&");
			const href =
				sign === "#"
					? `#system=${encode(found.target)}`
					: `#file=${encode(found.target)}&name=${encode(names.get(found.target) ?? "")}`;
			return `${before}[${label}](${href})${called.slice(found.as.length)}`;
		}),
	);
}

/** The files and directories the `@` mentions in `text` name, outside code. */
export function filesIn(
	text: string,
	named: Pick<Named, "systems" | "paths">,
): string[] {
	const found: string[] = [];
	outsideCode(text, (prose) => {
		for (const [, , sign, called = ""] of prose.matchAll(NAMING)) {
			const target =
				sign === "@" ? reading(named, sign, called)?.target : undefined;
			if (target !== undefined) {
				found.push(target);
			}
		}
		return prose;
	});
	return found;
}

/** The names of the systems `text` mentions as `#name` or `#alias`, outside code, each once. */
export function systemsIn(
	text: string,
	systems: readonly NamedSystem[],
): string[] {
	const found = new Set<string>();
	outsideCode(text, (prose) => {
		for (const [, , sign, called = ""] of prose.matchAll(NAMING)) {
			const target =
				sign === "#"
					? reading({ systems, paths: new Set() }, sign, called)?.target
					: undefined;
			if (target !== undefined) {
				found.add(target);
			}
		}
		return prose;
	});
	return [...found];
}

/**
 * The longest reading of `called`, after a `#` or `@` `sign`, that names one
 * of `named`'s systems or paths: as typed, or less what a sentence put after
 * it. With the system's name, or the path as `@` lists it.
 */
export function reading(
	named: Pick<Named, "systems" | "paths">,
	sign: string,
	called: string,
): { as: string; target: string } | undefined {
	for (const as of new Set([called, untrailed(called)])) {
		const target =
			sign === "#"
				? systemCalled(named.systems, as)?.name
				: pathCalled(named.paths, as);
		if (target !== undefined) {
			return { as, target };
		}
	}
	return undefined;
}

/** `called` less what a sentence may put after a mention. */
export function untrailed(called: string): string {
	return called.replace(TRAILING, "");
}

/** The system or file a link written by `linkNamed` names, or null for another. */
export function namedIn(
	href: string | undefined,
): { system: string } | { file: string; name?: string } | null {
	const link = NAMED_LINK.exec(href ?? "");
	if (link === null) {
		return null;
	}
	const target = decodeURIComponent(link[2] ?? "");
	if (link[1] === "system") {
		return { system: target };
	}
	return link[3] === undefined
		? { file: target }
		: { file: target, name: decodeURIComponent(link[3]) };
}

/** A mention `linkNamed` linked, as its chip. */
export function NamedChip({
	named,
}: {
	named: { system: string } | { file: string; name?: string | undefined };
}): JSX.Element {
	const { systems, tree } = use(NamedContext);
	if ("file" in named) {
		return (
			<FileChip
				path={tree === null ? named.file : `${tree}/${named.file}`}
				name={named.name}
				className="inline-flex h-6 align-middle"
			/>
		);
	}
	const system = systems.find((each) => each.name === named.system);
	return system === undefined ? (
		<span>#{named.system}</span>
	) : (
		<SystemChip system={system} />
	);
}

function systemCalled(
	systems: readonly NamedSystem[],
	called: string,
): NamedSystem | undefined {
	return systems.find(
		(system) =>
			system.name === called || (system.aliases ?? []).includes(called),
	);
}

/** The file or directory `called` names, a directory's with its `/` whether typed or not. */
function pathCalled(
	paths: ReadonlySet<string>,
	called: string,
): string | undefined {
	return [called, `${called}/`].find((each) => paths.has(each));
}

/** A path as a link's target can hold it, parentheses and all. */
function encode(path: string): string {
	return encodeURIComponent(path).replace(
		/[()]/g,
		(paren) => `%${paren.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}
