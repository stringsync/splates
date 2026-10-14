import type { TriggerAdapter } from "@assistant-ui/react";
import { useEffect, useMemo, useState } from "react";
import type { Command } from "../conversations";
import type { Details } from "../show";
import type { NamedSystem } from "../systems";
import { systems as fetchSystems, paths } from "./api";
import type { Named } from "./mentioned";
import { rank } from "./mentions";

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
 * What a tree names, for `NamedContext`, from its `paths` and `systems`, each
 * null while it loads, and where it sits.
 */
export function useNamed(
	paths: ReadonlySet<string> | null,
	systems: NamedSystem[] | null,
	tree: string | null,
): Named {
	return useMemo(
		() => ({
			systems: systems ?? [],
			paths: paths ?? new Set(),
			tree,
			resolving: { paths: paths === null, systems: systems === null },
		}),
		[paths, systems, tree],
	);
}

/**
 * The systems the tree `task` runs in names, for `#`; null until they come,
 * and none when they cannot. Asked again whenever the tasks move, which an
 * edit to a worktree's config does.
 */
export function useSystems(
	task: string | null,
	tasks: readonly Details[],
): NamedSystem[] | null {
	const [named, setNamed] = useState<NamedSystem[] | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tasks` only says when to ask again.
	useEffect(() => {
		let current = true;
		fetchSystems(task ?? "").then(
			(found) => current && setNamed(found),
			() => current && setNamed((named) => named ?? []),
		);
		return () => {
			current = false;
		};
	}, [task, tasks]);
	return named;
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
