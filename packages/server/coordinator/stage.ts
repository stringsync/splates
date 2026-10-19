import { resolve } from "node:path";
import type { Fs } from "webappwiz/system";
import { decodeTask, encodeTask, TASK_FILE } from "../board";
import { FsStorage } from "../storage";
import { WorkerRecords } from "../workers";
import { type MovedProject, rewriteRoots } from "./paths";

/**
 * What moves from splates's home: what the coordinator keeps, not what this
 * machine does for itself (dev slots, heavy jobs, locks, the local worker's
 * socket).
 */
export const MOVED_HOME = [
	"projects.json",
	"agents.json",
	"offered.json",
	"limits.json",
	"outcomes.jsonl",
	"outcome-usage.jsonl",
	"adherence.jsonl",
	"push.json",
	"setup.json",
	"tunnel.json",
	"ports.json",
	"coordinator.json",
	"restart.json",
	"workers.json",
	"worker-keys.json",
	"snapshots.json",
	"worker-budget.json",
];

/** A project as `stage` lays out its records. */
export interface StagedProject extends MovedProject {
	/** Where its worktrees are here, as its config says. */
	worktreeRoot: string;
}

/**
 * Lays out under `staging` what the box takes: `home/` for its `~/.splates`,
 * the roots in its records put as the box's clones, and the box's own worker
 * off, so agents run on workers alone; `projects/<slug>/` for each project's
 * `.git/splates` as it is, but that each task worked in a worktree here is
 * now on `worker`, this machine joined as one, where it carries on in place.
 */
export async function stage(opts: StageOptions): Promise<void> {
	const { fs, home, projects, staging, worker } = opts;
	for (const name of MOVED_HOME) {
		if (await fs.exists(`${home}/${name}`)) {
			await copyTree(fs, `${home}/${name}`, `${staging}/home/${name}`, (text) =>
				rewriteRoots(text, projects),
			);
		}
	}
	const workers = await WorkerRecords.open(
		new FsStorage(`${staging}/home`, fs).document("workers.json"),
	);
	await workers.turnLocal(false);
	for (const project of projects) {
		const records = `${staging}/projects/${project.slug}`;
		await copyTree(fs, `${project.root}/.git/splates`, records, (text) => text);
		await placeOn(fs, `${records}/tasks`, project.worktreeRoot, worker);
	}
}

/** What `stage` lays out, and where. */
export interface StageOptions {
	fs: Fs;
	/** splates's home here. */
	home: string;
	projects: StagedProject[];
	/** The directory it lays out under. */
	staging: string;
	/** What this machine is known by as a worker. */
	worker: string;
}

/**
 * Points each task record under `tasks` with no worker at `worker`, at the
 * worktree it has here, which the coordinator then reads and places its
 * agents in there.
 */
async function placeOn(
	fs: Fs,
	tasks: string,
	worktreeRoot: string,
	worker: string,
): Promise<void> {
	if (!(await fs.exists(tasks))) {
		return;
	}
	for (const name of await fs.readdir(tasks)) {
		if (!TASK_FILE.test(name)) {
			continue;
		}
		const path = `${tasks}/${name}`;
		const record = decodeTask(await fs.read(path));
		if (record === null) {
			continue; // as the service reads it: a record still, if unreadable
		}
		// A queued task has no tree to place.
		if (typeof record.machine === "string" || typeof record.task !== "string") {
			continue;
		}
		const worktree =
			typeof record.worktree === "string"
				? record.worktree
				: resolve(worktreeRoot, record.task);
		await fs.write(path, encodeTask({ ...record, worktree, machine: worker }));
	}
}

/**
 * Copies `from` to `to`, a file or a tree, leaving out locks, which name
 * this machine's processes, and passing each record and log through `edit`.
 */
export async function copyTree(
	fs: Fs,
	from: string,
	to: string,
	edit: (text: string) => string,
): Promise<void> {
	const name = from.slice(from.lastIndexOf("/") + 1);
	if (name.endsWith(".lock")) {
		return;
	}
	if ((await fs.stat(from)).isDirectory()) {
		await fs.mkdir(to, { recursive: true });
		for (const each of await fs.readdir(from)) {
			await copyTree(fs, `${from}/${each}`, `${to}/${each}`, edit);
		}
		return;
	}
	await fs.mkdir(to.slice(0, to.lastIndexOf("/")), { recursive: true });
	if (name.endsWith(".json") || name.endsWith(".jsonl")) {
		await fs.write(to, edit(await fs.read(from)));
		return;
	}
	await fs.writeBytes(to, await fs.readBytes(from));
}
