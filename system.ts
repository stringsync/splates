import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { fail } from "./exit";
import type { Git } from "./git";
import { type NamedSystem, Systems } from "./systems";
import type { WorktreeService } from "./worktree-service";

export interface ShowSystemsOptions {
	/** A system to print alone, by its name or an alias. */
	name?: string;
	/** Print only the systems this task's changed files fall in. */
	task?: string;
	/**
	 * The task the command runs in, read off the current branch: with no
	 * `task`, its worktree's systems are the ones read.
	 */
	here?: string | null;
	/** Print the systems as JSON instead of prose. */
	json?: boolean;
}

/**
 * The systems `arbor.systems.ts` names: every one, one by name, or those a
 * task touches. Read from the task's own worktree, so one it names counts
 * before it lands.
 */
export async function systems(
	{
		service,
		git,
		fs,
		log,
	}: { service: WorktreeService; git: Git; fs: Fs; log: Logger },
	{ name, task, here = null, json = false }: ShowSystemsOptions = {},
): Promise<void> {
	if (name !== undefined && task !== undefined) {
		fail("usage", "name a system or pass --task, not both", { name, task });
	}
	const tree = task ?? here;
	const worktree = tree === null ? null : await service.find(tree);
	if (task !== undefined && worktree?.gone) {
		fail(
			"not_found",
			`no task '${task}': run \`arbor list\` to see what there is`,
			{ task },
		);
	}
	const named = await Systems.at(worktree?.exists ? worktree.path : git.root, {
		fs,
	});

	let shown: NamedSystem[];
	if (name !== undefined) {
		const found = named.find(name);
		if (found === null) {
			fail(
				"not_found",
				`no system '${name}': run \`arbor systems\` to see what there is`,
				{ name },
			);
		}
		shown = [found];
	} else if (task !== undefined) {
		shown = named.touchedBy((await worktree?.changedFiles()) ?? []);
	} else {
		shown = named.all();
	}

	if (json) {
		log.info(JSON.stringify(shown, null, "\t"));
		return;
	}
	if (shown.length === 0) {
		log.info(
			task === undefined
				? "no systems named yet: name one in arbor.systems.ts"
				: `${task} touches no named system`,
		);
		return;
	}
	log.info(shown.map(describe).join("\n\n"));
}

function describe(system: NamedSystem): string {
	const aliases = system.aliases ?? [];
	const ignore = system.ignore ?? [];
	return [
		aliases.length > 0
			? `${color.bold(system.name)} (${aliases.join(", ")})`
			: color.bold(system.name),
		...(system.description === undefined ? [] : [`  ${system.description}`]),
		`  ${color.dim("globs")}   ${system.globs.join(", ")}`,
		...(ignore.length > 0
			? [`  ${color.dim("ignore")}  ${ignore.join(", ")}`]
			: []),
	].join("\n");
}
