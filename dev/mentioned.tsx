import { MessageCircleIcon } from "lucide-react";
import { createContext, type JSX, use } from "react";
import { buttonVariants } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ProjectRef } from "../conversation-host";
import { conversationReference } from "../conversation-reference";
import type { NamedSystem } from "../systems";
import { distinctNames, FileChip } from "./file-chip";
import { outsideCode } from "./markdown";
import { ProjectChip } from "./project-chip";
import { SystemChip } from "./systems";

/**
 * What the tree a conversation runs in names, for drawing the `#system`,
 * `#project`, `#uuid` and `@path` mentions in its messages: its systems, the arbor
 * projects on this machine, its paths, as `@` lists them, and where it sits,
 * so a file opens in the editor.
 */
export interface Named {
	/** Current display names, indexed by the stable conversation UUID. */
	conversations?: readonly { id: string; name: string }[];
	systems: readonly NamedSystem[];
	projects: readonly ProjectRef[];
	paths: ReadonlySet<string>;
	/** The tree's absolute path; null until it is known. */
	tree: string | null;
	/** Whether the paths, and the systems or projects, are still on their way. */
	resolving: { paths: boolean; systems: boolean };
}

export const NamedContext = createContext<Named>({
	systems: [],
	projects: [],
	paths: new Set(),
	tree: null,
	resolving: { paths: false, systems: false },
});

/** A `#` or `@` at the start or after a space, and what follows it. */
export const NAMING = /(^|\s)([#@])([^\s#@]+)/g;

/** What a sentence may put after a mention, which is not part of it. */
const TRAILING = /[.,;:!?)\]'"]+$/;

/** Where a link written by `linkNamed` points, read back by `namedIn`. */
const NAMED_LINK = /^#(system|project|file)=([^&]+)(?:&name=(.+))?$/;

/**
 * `text` with each `#name` naming one of `named`'s systems, by its name or an
 * alias, a project by its slug, or a conversation by UUID, and each `@path`
 * naming one of its files or directories, outside
 * code, made a link that `namedIn` reads back. A mention that names nothing,
 * such as `#12` or a path not in the tree, is left alone.
 */
export function linkNamed(
	text: string,
	named: Pick<Named, "systems" | "projects" | "paths" | "conversations">,
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
					? found.kind === "conversation"
						? `#conversations/${encode(found.target)}`
						: `#${found.kind}=${encode(found.target)}`
					: `#file=${encode(found.target)}&name=${encode(names.get(found.target) ?? "")}`;
			return `${before}[${label}](${href})${called.slice(found.as.length)}`;
		}),
	);
}

/** The files and directories the `@` mentions in `text` name, outside code. */
export function filesIn(
	text: string,
	named: Pick<Named, "systems" | "projects" | "paths" | "conversations">,
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
					? reading({ systems, projects: [], paths: new Set() }, sign, called)
							?.target
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
 * of `named`'s systems, projects, conversations or paths: as typed, or less what a sentence
 * put after it. With the system's name, the project's slug, or the path as
 * `@` lists it, and which of them it is; a system wins over a project of the
 * same name, as for the agent.
 */
export function reading(
	named: Pick<Named, "systems" | "projects" | "paths" | "conversations">,
	sign: string,
	called: string,
):
	| {
			as: string;
			target: string;
			kind: "system" | "project" | "file" | "conversation";
	  }
	| undefined {
	for (const as of new Set([called, untrailed(called)])) {
		if (sign === "@") {
			const path = pathCalled(named.paths, as);
			if (path !== undefined) {
				return { as, target: path, kind: "file" };
			}
			continue;
		}
		if (
			conversationReference(as) ||
			named.conversations?.some((each) => each.id === as)
		) {
			return { as, target: as, kind: "conversation" };
		}
		const system = systemCalled(named.systems, as);
		if (system !== undefined) {
			return { as, target: system.name, kind: "system" };
		}
		if (named.projects.some((each) => each.slug === as)) {
			return { as, target: as, kind: "project" };
		}
	}
	return undefined;
}

/** `called` less what a sentence may put after a mention. */
export function untrailed(called: string): string {
	return called.replace(TRAILING, "");
}

/** What a link written by `linkNamed` names, or null for another. */
export type NamedTarget =
	| { conversation: string }
	| { system: string }
	| { project: string }
	| { file: string; name?: string | undefined };

/** The target a link written by `linkNamed` names, or null for another. */
export function namedIn(href: string | undefined): NamedTarget | null {
	const conversation = href?.match(/^#conversations\/([^/]+)$/)?.[1];
	if (conversation !== undefined && conversationReference(conversation)) {
		return { conversation: decodeURIComponent(conversation) };
	}
	const link = NAMED_LINK.exec(href ?? "");
	if (link === null) {
		return null;
	}
	const target = decodeURIComponent(link[2] ?? "");
	if (link[1] === "system") {
		return { system: target };
	}
	if (link[1] === "project") {
		return { project: target };
	}
	return link[3] === undefined
		? { file: target }
		: { file: target, name: decodeURIComponent(link[3]) };
}

/** A mention `linkNamed` linked, as its chip. */
export function NamedChip({ named }: { named: NamedTarget }): JSX.Element {
	const { systems, projects, tree, conversations } = use(NamedContext);
	if ("conversation" in named) {
		const name =
			conversations?.find((each) => each.id === named.conversation)?.name ??
			named.conversation;
		return (
			<a
				href={`#conversations/${encodeURIComponent(named.conversation)}`}
				title={name}
				onClick={(event) => event.stopPropagation()}
				className={cn(
					buttonVariants({ variant: "outline", size: "xs" }),
					"max-w-80 align-middle",
				)}
			>
				<MessageCircleIcon aria-hidden data-icon="inline-start" />
				<span className="truncate">{name}</span>
			</a>
		);
	}
	if ("file" in named) {
		return (
			<FileChip
				path={tree === null ? named.file : `${tree}/${named.file}`}
				name={named.name}
				className="inline-flex h-6 align-middle"
			/>
		);
	}
	if ("project" in named) {
		const project = projects.find((each) => each.slug === named.project);
		return project === undefined ? (
			<span>#{named.project}</span>
		) : (
			<ProjectChip project={project} />
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
