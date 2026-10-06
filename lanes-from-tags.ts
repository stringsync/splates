import { isAbsolute, resolve } from "node:path";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { FileLock, type Fs, NodeFs, NodePs, type Ps } from "webappwiz/system";
import { Todos } from "./todos";

/** Where the repository at `dir` keeps its todos, and what to do it with. */
export interface LanesFromTagsOptions {
	/** The root of a repository, or of one of its worktrees. */
	dir: string;
	log?: Logger;
	fs?: Fs;
	ps?: Ps;
}

/**
 * Moves the todos of the repository at `dir` that still have tags, from
 * before arbor kept lanes instead, into a lane a tag, and says where each
 * went; arbor refuses to read them until then. Says nothing when `dir` is
 * no repository, keeps no todos, or none has tags.
 */
export async function lanesFromTags(opts: LanesFromTagsOptions): Promise<void> {
	const log = opts.log ?? new ConsoleLogger();
	const fs = opts.fs ?? new NodeFs();
	const git = await commonDir(opts.dir, fs);
	if (git === null || !(await fs.exists(`${git}/arbor/todos`))) {
		return;
	}
	const todos = new Todos(
		`${git}/arbor/todos`,
		new FileLock(`${git}/arbor/todos.lock`, {
			fs,
			ps: opts.ps ?? new NodePs(),
			log,
		}),
		{ fs },
	);
	for (const { lane, todos: moved } of await todos.moveTagsToLanes()) {
		log.info(
			`moved ${moved.map((id) => `#${id}`).join(", ")} into lane ${lane.id} ${lane.name}, from their tag`,
		);
	}
}

/**
 * The `.git` directory every worktree of the repository at `dir` shares, or
 * null for none. A worktree's `.git` is a file naming its own directory,
 * whose `commondir` leads to the shared one.
 */
async function commonDir(dir: string, fs: Fs): Promise<string | null> {
	const dotGit = `${dir}/.git`;
	if (!(await fs.exists(dotGit))) {
		return null;
	}
	if ((await fs.stat(dotGit)).isDirectory()) {
		return dotGit;
	}
	const own = /^gitdir:\s*(.+)$/m.exec(await fs.read(dotGit))?.[1]?.trim();
	if (own === undefined) {
		return null;
	}
	const worktree = isAbsolute(own) ? own : resolve(dir, own);
	const common = await fs
		.read(`${worktree}/commondir`)
		.then((text) => text.trim())
		.catch(() => ".");
	return isAbsolute(common) ? common : resolve(worktree, common);
}
