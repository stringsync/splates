import type {
	ElsewhereBlocker,
	ElsewhereBoards,
} from "@stringsync/splates-server/board";
import { commaList } from "@stringsync/splates-server/comma-list";
import { fail } from "@stringsync/splates-server/exit";

/**
 * Reads `--blocked-by` and `--remove-blocked-by` in the project at `here`:
 * a number names a task here, `webappwiz#404` or `webappwiz #404` one of
 * another project, as `boards` finds it, and this project's own slug a task
 * here. A task of another project that `--blocked-by` names has to be open
 * there; one `--remove-blocked-by` names need not.
 */
export async function blockerFlags({
	boards,
	here,
	blockedBy = [],
	removeBlockedBy = [],
}: BlockerFlagsOptions): Promise<BlockerFlags> {
	const ids: number[] = [];
	const blockedElsewhere: ElsewhereBlocker[] = [];
	for (const named of await namedIn(boards, here, blockedBy)) {
		if (named.project === null) {
			ids.push(named.id);
			continue;
		}
		const found = await boards.find(named.project, named.id);
		if (found === null) {
			fail(
				"not_found",
				`the tasks of ${named.written} cannot be read: is ${named.slug} set up with \`splates init\`?`,
				{ blockedBy: named.written },
			);
		}
		if (found.status === "merged" || found.status === "removed") {
			fail(
				"not_found",
				`${named.written} is ${found.status === "merged" ? `merged, as ${found.commit}` : "gone, removed without merging"}: nothing waits on it any more`,
				{ blockedBy: named.written },
			);
		}
		blockedElsewhere.push({
			project: named.project,
			id: named.id,
			subject: found.subject,
		});
	}
	const unblocked: BlockerFlags["unblocked"] = { ids: [], elsewhere: [] };
	for (const named of await namedIn(boards, here, removeBlockedBy)) {
		if (named.project === null) {
			unblocked.ids.push(named.id);
		} else {
			unblocked.elsewhere.push({ project: named.project, id: named.id });
		}
	}
	return { blockedBy: ids, blockedElsewhere, unblocked };
}

/** What `blockerFlags` reads, and where. */
export interface BlockerFlagsOptions {
	boards: ElsewhereBoards;
	/** This project's main tree. */
	here: string;
	/** `--blocked-by`, as given. */
	blockedBy?: readonly string[];
	/** `--remove-blocked-by`, as given. */
	removeBlockedBy?: readonly string[];
}

/** The tasks the flags name, here and in other projects. */
export interface BlockerFlags {
	blockedBy: number[];
	blockedElsewhere: ElsewhereBlocker[];
	/** Those no longer to block it. */
	unblocked: { ids: number[]; elsewhere: { project: string; id: number }[] };
}

/** One task a flag names, `project` null for one here. */
interface Named {
	project: string | null;
	slug: string;
	id: number;
	written: string;
}

function id(digits: string | undefined): number {
	const parsed = Number(digits);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		fail("usage", `'${digits}' is not a task number`, { number: digits });
	}
	return parsed;
}

async function namedIn(
	boards: ElsewhereBoards,
	here: string,
	raw: readonly string[],
): Promise<Named[]> {
	const named: Named[] = [];
	for (const value of commaList(raw.join(","))) {
		const local = /^#?(\d+)$/.exec(value);
		if (local !== null) {
			named.push({
				project: null,
				slug: "",
				id: id(local[1]),
				written: value,
			});
			continue;
		}
		const other = /^#?([\w.-]+)(?:\s+task)?\s*#(\d+)$/i.exec(value);
		if (other === null) {
			fail(
				"usage",
				`'${value}' is not a task: pass its number, or <project>#<number> for one of another project`,
				{ blockedBy: value },
			);
		}
		const slug = other[1] as string;
		const root = await boards.root(slug);
		if (root === null) {
			fail(
				"not_found",
				`no splates project '${slug}' on this machine: \`splates projects\` lists them`,
				{ blockedBy: value },
			);
		}
		named.push({
			project: root === here ? null : root,
			slug,
			id: id(other[2]),
			written: `${slug} #${other[2]}`,
		});
	}
	return named;
}
