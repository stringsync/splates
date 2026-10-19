import { basename } from "node:path";
import type { Fs } from "webappwiz/system";
import type { Migration } from "./format";

/**
 * @internal Where, under `.git/splates`, format 1's records stay as they
 * were, a backup until a later release removes it.
 */
export const BACKUP = "format-1";

/** What format 1 kept apart, which `ONE_TASK_STORE` moves into the backup. */
const OLD = ["todos", "tasks", "lane-todos.json", "groomed-todos"];

/** What the store keeps of the list beside its records, as `todos/` did. */
const LIST_FILES = ["lanes", "ended-lanes", "last-lane", "removed"];

/**
 * @internal Format 1 → 2: todos and tasks become one store of numbered tasks under
 * `tasks/<N>.json`. Each todo is a queued task under its number. Each task
 * is started under the lowest-numbered todo it took, the rest queued and
 * held by it, or under a number of its own, off the list, when it took
 * none. A task's files are in `tasks/<N>/started/`, a todo's in
 * `tasks/<N>/`.
 */
export const ONE_TASK_STORE: Migration = {
	does: "merges todos and tasks into one store of numbered tasks",
	async run(splatesDir, fs) {
		// It reads the records as format 1 wrote them, never through the code
		// that reads today's, so it stays right as that code moves on. Cut
		// short, it runs again from the backup, which it fills before writing
		// anything new.
		const backup = `${splatesDir}/${BACKUP}`;
		await fs.mkdir(backup);
		for (const name of OLD) {
			if (
				!(await fs.exists(`${backup}/${name}`)) &&
				(await fs.exists(`${splatesDir}/${name}`))
			) {
				await fs.rename(`${splatesDir}/${name}`, `${backup}/${name}`);
			}
		}

		const store = `${splatesDir}/tasks`;
		await fs.rm(store, { recursive: true, force: true });
		await fs.mkdir(store);
		const oldTodos = `${backup}/todos`;
		const oldTasks = `${backup}/tasks`;

		const todos = new Map<number, Json>();
		for (const entry of await jsonFiles(fs, oldTodos)) {
			const todo = await readJson(fs, `${oldTodos}/${entry}`);
			if (todo !== null && typeof todo.id === "number") {
				todos.set(todo.id, {
					...todo,
					files: moved(todo.files, store),
					status: "queued",
				});
			}
		}
		for (const name of await fs.readdir(oldTodos).catch(() => [])) {
			if (/^\d+$/.test(name)) {
				await copy(fs, `${oldTodos}/${name}`, `${store}/${name}`);
			}
		}
		for (const name of LIST_FILES) {
			if (await fs.exists(`${oldTodos}/${name}`)) {
				await copy(fs, `${oldTodos}/${name}`, `${store}/${name}`);
			}
		}
		// A removed todo kept to be put back names its files where they now are.
		for (const entry of await jsonFiles(fs, `${store}/removed`)) {
			const path = `${store}/removed/${entry}`;
			const kept = await readJson(fs, path);
			const state = kept?.state as Json | undefined;
			if (kept !== null && state !== undefined) {
				await writeJson(fs, path, {
					...kept,
					state: { ...state, files: moved(state.files, store) },
				});
			}
		}

		let last = Math.max(
			Number(await fs.read(`${oldTodos}/last`).catch(() => 0)) || 0,
			...todos.keys(),
		);
		const records = new Map(todos);
		for (const entry of (await jsonFiles(fs, oldTasks)).sort()) {
			const task = await readJson(fs, `${oldTasks}/${entry}`);
			if (task === null) {
				continue; // as format 1 read it: no task to start
			}
			const name =
				typeof task.task === "string" ? task.task : entry.slice(0, -5);
			const { createdAt, status, ...started } = task;
			const held = [...todos.values()]
				.filter((todo) => todo.takenBy === name)
				.map((todo) => todo.id as number)
				.sort((left, right) => left - right)
				.find((id) => typeof records.get(id)?.task !== "string");
			let record: Json;
			if (held === undefined) {
				last += 1;
				record = {
					id: last,
					subject: name,
					text: "",
					position: 0,
					from: null,
					createdAt,
					takenBy: null,
					files: [],
					blockedBy: [],
					lane: null,
					listed: false,
				};
			} else {
				record = records.get(held) as Json;
			}
			records.set(record.id as number, {
				...record,
				...started,
				task: name,
				startedAt: createdAt,
				status,
			});
			if (await fs.exists(`${oldTasks}/${name}`)) {
				await copy(fs, `${oldTasks}/${name}`, `${store}/${record.id}/started`);
			}
		}
		for (const record of records.values()) {
			await writeJson(fs, `${store}/${record.id}.json`, record);
		}
		await fs.write(`${store}/last`, String(last));

		if (await fs.exists(`${backup}/lane-todos.json`)) {
			await copy(
				fs,
				`${backup}/lane-todos.json`,
				`${splatesDir}/lane-tasks.json`,
			);
		}
		if (await fs.exists(`${backup}/groomed-todos`)) {
			await fs.rm(`${splatesDir}/groomed-tasks`, {
				recursive: true,
				force: true,
			});
			await copy(fs, `${backup}/groomed-todos`, `${splatesDir}/groomed-tasks`);
		}
	},
};

type Json = Record<string, unknown>;

/**
 * A todo's file paths as they are once its folder is copied into the store,
 * `todos/<N>/<file>` becoming `tasks/<N>/<file>`.
 */
function moved(files: unknown, store: string): string[] {
	if (!Array.isArray(files)) {
		return [];
	}
	return files.map((path: string) => {
		const folder = basename(path.slice(0, path.lastIndexOf("/")));
		return `${store}/${folder}/${basename(path)}`;
	});
}

async function jsonFiles(fs: Fs, dir: string): Promise<string[]> {
	return (await fs.readdir(dir).catch(() => [])).filter((entry) =>
		entry.endsWith(".json"),
	);
}

async function readJson(fs: Fs, path: string): Promise<Json | null> {
	try {
		const parsed = JSON.parse(await fs.read(path)) as unknown;
		return parsed !== null && typeof parsed === "object"
			? (parsed as Json)
			: null;
	} catch {
		return null;
	}
}

async function writeJson(fs: Fs, path: string, value: Json): Promise<void> {
	await fs.write(path, `${JSON.stringify(value, null, "\t")}\n`);
}

/** Copies `from` to `to`, a file or a tree. */
async function copy(fs: Fs, from: string, to: string): Promise<void> {
	if (!(await fs.stat(from)).isDirectory()) {
		await fs.writeBytes(to, await fs.readBytes(from));
		return;
	}
	await fs.mkdir(to);
	for (const name of await fs.readdir(from)) {
		await copy(fs, `${from}/${name}`, `${to}/${name}`);
	}
}
