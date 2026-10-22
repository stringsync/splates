import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Fs, Lock, Ps } from "webappwiz/system";
import { z } from "zod";
import type { Config } from "../config";
import type { Git } from "../git";
import { landLocally, type TaskBranches, type TrunkLanding } from "../merge";
import { TaskOverlaps, type WorktreeService } from "../tasks";
import { Notes } from "./notes";

/**
 * A note as the page writes it: `file` in the notes directory, its
 * description and body. `path` is the note it replaces, null for a new one,
 * and `from` the blob that note was opened at, so a note changed since
 * then is not overwritten unless `force` says to.
 */
export const NoteSave = z.object({
	path: z.string().nullable(),
	file: z.string(),
	description: z.string(),
	body: z.string(),
	from: z.string().nullable(),
	force: z.boolean().optional(),
});
export type NoteSave = z.infer<typeof NoteSave>;

/** A note the page removes, opened at blob `from`. */
export const NoteRemoval = z.object({
	path: z.string(),
	from: z.string().nullable(),
	force: z.boolean().optional(),
});
export type NoteRemoval = z.infer<typeof NoteRemoval>;

/** How a save went. */
export type NoteSaved =
	/** On trunk as `commit`; `path` is the note now, null once removed. */
	| { status: "landed"; commit: string; path: string | null }
	/** Not landed, since the note changed on trunk or `tasks` are changing it: save again with `force` to land it over them. */
	| { status: "conflict"; why: string; tasks: string[] }
	/** Not landed, for `why`; trying again may land it. */
	| { status: "refused"; why: string };

/** The branch a save is pushed as on its way to a remote trunk. */
const PUSHED_AS = "notes-page";

/**
 * Lands each note the page writes as its own commit on trunk, built from
 * trunk's tree without a checkout and landed by compare-and-swap under the
 * merge lease, as a task's merge lands. Nothing is written into the main
 * tree but what the landing checks out there.
 */
export class NoteSaves {
	// One at a time in this process: the lease object is shared, and the
	// index a save builds in is too.
	#queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly deps: {
			git: Git;
			fs: Fs;
			ps: Ps;
			lock: Lock;
			config: Config;
			service: WorktreeService;
			branches: TaskBranches;
			trunk: TrunkLanding;
			dir: string;
		},
	) {}

	save(change: NoteSave): Promise<NoteSaved> {
		return this.#serial(async () => {
			const description = change.description.trim();
			if (description === "" || /[\r\n]/.test(description)) {
				return refused("a note needs a one-line description");
			}
			if (!/^[^/\\.][^/\\]*\.md$/.test(change.file)) {
				return refused(
					`'${change.file}' is not a note's filename: a name ending in .md, without slashes`,
				);
			}
			const dir = this.#dir();
			if (dir === null) {
				return refused("the notes directory is outside the checkout");
			}
			const old = change.path === null ? null : await this.#listed(change.path);
			if (change.path !== null && old === null) {
				return refused("That project note no longer exists.");
			}
			const target = `${dir}${change.file}`;
			const verb = old === null ? "Add" : old === target ? "Edit" : "Rename";
			return this.#land({
				remove: old !== null && old !== target ? old : null,
				write: {
					path: target,
					text: compose(
						old === null
							? null
							: await this.deps.fs.read(join(this.deps.git.root, old)),
						description,
						change.body,
					),
					fresh: old !== target,
				},
				guarded: old,
				from: change.from,
				force: change.force === true,
				message:
					verb === "Rename" && old !== null
						? `Rename note ${relative(dir, old)} to ${change.file}`
						: `${verb} note ${change.file}: ${description}`,
			});
		});
	}

	remove(change: NoteRemoval): Promise<NoteSaved> {
		return this.#serial(async () => {
			const dir = this.#dir();
			const old = await this.#listed(change.path);
			if (dir === null || old === null) {
				return refused("That project note no longer exists.");
			}
			return this.#land({
				remove: old,
				write: null,
				guarded: old,
				from: change.from,
				force: change.force === true,
				message: `Remove note ${relative(dir, old)}`,
			});
		});
	}

	/** The blob a note's file holds, which a save names as what it was opened at. */
	async blob(path: string): Promise<string | null> {
		const hashed = await this.deps.git.run(
			this.deps.git.root,
			"hash-object",
			"--no-filters",
			"--",
			path,
		);
		return hashed.code === 0 ? hashed.stdout : null;
	}

	async #land(change: {
		remove: string | null;
		write: { path: string; text: string; fresh: boolean } | null;
		/** The note as opened, which must still be `from` on trunk. */
		guarded: string | null;
		from: string | null;
		force: boolean;
		message: string;
	}): Promise<NoteSaved> {
		const { lock, service } = this.deps;
		const touched = [change.remove, change.write?.path, change.guarded].filter(
			(path): path is string => path !== null && path !== undefined,
		);
		if (!change.force) {
			const tasks = (await new TaskOverlaps(service).files())
				.filter(({ files }) => files.some((file) => touched.includes(file)))
				.map(({ task }) => task);
			if (tasks.length > 0) {
				return {
					status: "conflict",
					why: `${tasks.map((task) => `'${task}'`).join(", ")} ${tasks.length === 1 ? "is" : "are"} changing this note too, and would meet this save when ${tasks.length === 1 ? "it rebases" : "they rebase"}`,
					tasks,
				};
			}
		}
		await lock.acquire();
		try {
			// A trunk that moves meanwhile is read again, as a merge rebases.
			for (let attempt = 0; attempt < 3; attempt++) {
				const onto = await this.#trunk();
				if (typeof onto !== "string") {
					return onto;
				}
				const opened =
					change.guarded === null ? null : await this.#at(onto, change.guarded);
				if (change.guarded !== null && opened === null) {
					return refused("That project note no longer exists.");
				}
				if (!change.force && opened !== change.from) {
					return {
						status: "conflict",
						why: "this note changed on trunk since you opened it",
						tasks: [],
					};
				}
				if (
					change.write?.fresh === true &&
					(await this.#at(onto, change.write.path)) !== null
				) {
					return refused(`a note at ${change.write.path} already exists`);
				}
				const head = await this.#commit(onto, change);
				const landed = await this.#push(onto, head);
				if (landed === "moved") {
					continue;
				}
				if (landed !== "landed") {
					return landed;
				}
				return {
					status: "landed",
					commit: head,
					path:
						change.write === null
							? null
							: join(this.deps.git.root, change.write.path),
				};
			}
			return refused("trunk kept moving under the save: save again");
		} finally {
			await lock.release();
		}
	}

	/** The commit trunk is at, fetched from the remote when there is one. */
	async #trunk(): Promise<string | NoteSaved> {
		const { git, config, branches } = this.deps;
		if (config.remote === null) {
			return git.out(git.root, "rev-parse", `refs/heads/${config.trunk}`);
		}
		const fetched = await branches.fetchTrunk(
			PUSHED_AS,
			config.trunk,
			git.root,
		);
		return fetched.status === "fetched"
			? fetched.commit
			: refused(
					`could not fetch ${config.remote}'s ${config.trunk}${fetched.status === "off" ? "" : `: ${fetched.why}`}`,
				);
	}

	/** The blob at `path` in `commit`, or null when it has none. */
	async #at(commit: string, path: string): Promise<string | null> {
		const found = await this.deps.git.run(
			this.deps.git.root,
			"rev-parse",
			"--verify",
			"--quiet",
			`${commit}:${path}`,
		);
		return found.code === 0 ? found.stdout : null;
	}

	/** One commit on `onto` with the change, built in an index of its own. */
	async #commit(
		onto: string,
		change: {
			remove: string | null;
			write: { path: string; text: string } | null;
			message: string;
		},
	): Promise<string> {
		const { git, fs, dir } = this.deps;
		const scratch = join(dir, "note-save");
		await fs.mkdir(scratch, { recursive: true });
		const env = { GIT_INDEX_FILE: join(scratch, "index") };
		const run = async (...args: string[]): Promise<string> => {
			const result = await git.runWith(git.root, args, env);
			if (result.code !== 0) {
				throw new Error(`git ${args[0]}: ${result.stderr || result.stdout}`);
			}
			return result.stdout;
		};
		try {
			await run("read-tree", onto);
			if (change.remove !== null) {
				await run("update-index", "--force-remove", "--", change.remove);
			}
			if (change.write !== null) {
				const file = join(scratch, "blob");
				await fs.write(file, change.write.text);
				const blob = await run("hash-object", "-w", "--no-filters", "--", file);
				await run(
					"update-index",
					"--add",
					"--cacheinfo",
					`100644,${blob},${change.write.path}`,
				);
			}
			const tree = await run("write-tree");
			return await run("commit-tree", tree, "-p", onto, "-m", change.message);
		} finally {
			await fs.rm(scratch, { recursive: true, force: true });
		}
	}

	/** Moves trunk from `onto` to `head`, here or on the remote. */
	async #push(
		onto: string,
		head: string,
	): Promise<"landed" | "moved" | NoteSaved> {
		const { git, ps, config, branches, trunk } = this.deps;
		if (config.remote === null) {
			const merged = await landLocally({
				git,
				base: config.trunk,
				onto,
				head,
				landing: await git.worktreeFor(config.trunk),
			});
			if (merged.moved === true) {
				return "moved";
			}
			return merged.code === 0
				? "landed"
				: refused(
						`could not check the note out in the main tree: ${merged.stderr || merged.stdout}`,
					);
		}
		const branch = `refs/heads/${PUSHED_AS}`;
		await git.out(git.root, "update-ref", branch, head);
		try {
			const pushed = await branches.push(PUSHED_AS, PUSHED_AS);
			if (pushed.status !== "pushed") {
				return refused(
					`could not push the note to ${config.remote}${pushed.status === "off" ? "" : `: ${pushed.why}`}`,
				);
			}
			const landed = await trunk.land({
				task: PUSHED_AS,
				onto,
				head,
				holder: { pid: ps.pid, hostname: ps.hostname },
			});
			if (landed.status === "refused") {
				return refused(landed.why);
			}
			return landed.status;
		} finally {
			await branches.delete(PUSHED_AS);
			await git.run(git.root, "update-ref", "-d", branch);
		}
	}

	/** The notes directory from the checkout's root, with a trailing slash, as git names paths. */
	#dir(): string | null {
		const { git, config } = this.deps;
		const dir = relative(
			git.root,
			resolve(git.root, config.notesDir ?? "notes"),
		);
		if (dir.startsWith("..") || isAbsolute(dir)) {
			return null;
		}
		return dir === "" ? "" : `${dir.split(sep).join("/")}/`;
	}

	/** A listed note's path from the root, or null for any other file. */
	async #listed(path: string): Promise<string | null> {
		const { git, fs, config } = this.deps;
		const found = (await new Notes(fs).list(git.root, config)).find(
			(note) => note.path === path,
		);
		return found === undefined
			? null
			: relative(git.root, found.path).split(sep).join("/");
	}

	#serial<T>(work: () => Promise<T>): Promise<T> {
		const done = this.#queue.then(work);
		this.#queue = done.catch(() => {});
		return done;
	}
}

function refused(why: string): NoteSaved {
	return { status: "refused", why };
}

/**
 * The note's text: `description` and `body` under the frontmatter it had,
 * so any other field in it stays.
 */
function compose(
	text: string | null,
	description: string,
	body: string,
): string {
	const fields =
		text?.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? null;
	const kept = (fields ?? "")
		.split("\n")
		.filter((line) => line !== "" && !/^description\s*:/.test(line));
	const content = body.replace(/\r\n/g, "\n").replace(/^\n+/, "");
	return `---\ndescription: ${description}\n${kept.map((line) => `${line}\n`).join("")}---\n\n${content.endsWith("\n") || content === "" ? content : `${content}\n`}`;
}
