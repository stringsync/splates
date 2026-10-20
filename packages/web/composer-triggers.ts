import type { TriggerAdapter } from "@assistant-ui/react";
import type {
	Command,
	ProjectRef,
} from "@stringsync/splates-server/conversations";
import { nameOf } from "@stringsync/splates-server/conversations/browser";
import { useReactive } from "@webappwiz/react";
import { useContext, useEffect, useMemo, useState } from "react";
import { paths } from "./api";
import { Lanes } from "./conversation-names";
import { useHeldConversations } from "./handed-out";
import type { Named } from "./mentioned";
import { rank } from "./mentions";
import { NoteReader } from "./note-reader";
import { listProjects } from "./project-api";

/**
 * The tree's paths for the composer's `@`, once they have loaded, and as the
 * set a sent message's `@` mentions are found in; null while they load.
 */
export function useFileMentions(task: string | null): {
	adapter: TriggerAdapter | null;
	paths: ReadonlySet<string> | null;
} {
	const [all, setAll] = useState<string[] | null>(null);
	useEffect(() => {
		let current = true;
		paths(task ?? "").then(
			(found) => current && setAll(found),
			// Without the list, `@` is only a character: nothing else breaks.
			() => current && setAll([]),
		);
		return () => {
			current = false;
		};
	}, [task]);
	return useMemo(
		() => ({
			adapter:
				all === null || all.length === 0
					? null
					: {
							categories: () => [],
							categoryItems: () => [],
							search: (query: string) =>
								(query === "" ? all : rank(all, query))
									.slice(0, MENTIONS_SHOWN)
									.map((path) => ({ id: path, type: "file", label: path })),
						},
			paths: all === null ? null : new Set(all),
		}),
		[all],
	);
}

const MENTIONS_SHOWN = 8;

/**
 * What a tree names, for `NamedContext`, from its `paths` and the
 * machine's `projects`, each null while it loads, and where it sits.
 */
export function useNamed(
	paths: ReadonlySet<string> | null,
	projects: ProjectRef[] | null,
	tree: string | null,
	notesRoot: string | null,
): Named {
	const [reader] = useState(() => new NoteReader());
	const notes = useReactive(reader, (each) => each.notes, ["changed"]);
	useEffect(() => {
		void reader.list();
		return () => reader.cancel();
	}, [reader]);
	const held = useHeldConversations();
	const lanes = useContext(Lanes);
	return useMemo(
		() => ({
			notes,
			notesRoot,
			conversations: held.map((each) => ({
				id: each.id,
				name: nameOf(each, lanes),
			})),
			projects: projects ?? [],
			paths: paths ?? new Set(),
			tree,
			resolving: {
				paths: paths === null,
				projects: projects === null,
			},
		}),
		[paths, projects, tree, held, lanes, notes, notesRoot],
	);
}

/**
 * The splates projects on this machine, for `#`, those gone left out; null
 * until they come, and none when they cannot. Asked once: a project added
 * meanwhile shows on the next visit.
 */
export function useProjects(): ProjectRef[] | null {
	const [projects, setProjects] = useState<ProjectRef[] | null>(null);
	useEffect(() => {
		let current = true;
		listProjects().then(
			(listed) =>
				current &&
				setProjects(
					listed.projects
						.filter((each) => !each.gone)
						.map(({ slug, root }) => ({ slug, root })),
				),
			() => current && setProjects([]),
		);
		return () => {
			current = false;
		};
	}, []);
	return projects;
}

/**
 * The agent's skills and commands for the composer's `/`, those whose name
 * starts with what was typed first, then those that hold it; none until the
 * agent says what it has.
 */
export function useCommands(commands: Command[]): TriggerAdapter | null {
	return useMemo(
		() =>
			commands.length === 0
				? null
				: {
						categories: () => [],
						categoryItems: () => [],
						search: (query: string) => {
							const typed = query.toLowerCase();
							const named = (command: Command) => command.name.toLowerCase();
							return [
								...commands.filter((each) => named(each).startsWith(typed)),
								...commands.filter(
									(each) =>
										!named(each).startsWith(typed) &&
										named(each).includes(typed),
								),
							].map((command) => ({
								id: command.name,
								type: "command",
								label: command.name,
								description: command.description,
							}));
						},
					},
		[commands],
	);
}
