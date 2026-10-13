import { createContext, type JSX, use } from "react";
import type { NamedSystem } from "../systems";
import { FileChip } from "./file-chip";
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
}

export const NamedContext = createContext<Named>({
	systems: [],
	paths: new Set(),
	tree: null,
});

/** A `#` or `@` at the start or after a space, and what follows it. */
const NAMING = /(^|\s)([#@])([^\s#@]+)/g;

/** What a sentence may put after a mention, which is not part of it. */
const TRAILING = /[.,;:!?)\]'"]+$/;

/** Where a link written by `linkNamed` points, read back by `namedIn`. */
const NAMED_LINK = /^#(system|file)=(.+)$/;

/**
 * `text` with each `#name` naming one of `named`'s systems, by its name or an
 * alias, and each `@path` naming one of its files or directories, outside
 * code, made a link that `namedIn` reads back. A mention that names nothing,
 * such as `#12` or a path not in the tree, is left alone.
 */
export function linkNamed(text: string, named: Named): string {
	return outsideCode(text, (prose) =>
		prose.replace(NAMING, (whole, before: string, sign: string, called) => {
			// The longest reading that names something: as typed, or less what a
			// sentence put after it.
			for (const each of new Set([called, called.replace(TRAILING, "")])) {
				const target =
					sign === "#"
						? systemCalled(named.systems, each)?.name
						: pathCalled(named.paths, each);
				if (target !== undefined) {
					const kind = sign === "#" ? "system" : "file";
					const label = `${sign}${each}`.replace(/[[\]\\]/g, "\\$&");
					return `${before}[${label}](#${kind}=${encode(target)})${called.slice(each.length)}`;
				}
			}
			return whole;
		}),
	);
}

/** The system or file a link written by `linkNamed` names, or null for another. */
export function namedIn(
	href: string | undefined,
): { system: string } | { file: string } | null {
	const link = NAMED_LINK.exec(href ?? "");
	if (link === null) {
		return null;
	}
	const target = decodeURIComponent(link[2] ?? "");
	return link[1] === "system" ? { system: target } : { file: target };
}

/** A mention `linkNamed` linked, as its chip. */
export function NamedChip({
	named,
}: {
	named: { system: string } | { file: string };
}): JSX.Element {
	const { systems, tree } = use(NamedContext);
	if ("file" in named) {
		return (
			<FileChip
				path={tree === null ? named.file : `${tree}/${named.file}`}
				className="inline-flex align-middle"
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
