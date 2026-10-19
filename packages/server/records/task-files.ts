import type { Fs } from "webappwiz/system";
import type { Migration } from "./format";

/**
 * @internal Format 2 → 3: each `tasks/<N>.json` becomes `tasks/<N>.md`, its
 * fields as JSON front matter and its text as the body, so a task reads as
 * the `SPLATES.md` it grows into. A queued task gains its stage: `ready`
 * when it has a model named, as grooming leaves one, else `backlog`.
 */
export const TASK_FILES: Migration = {
	does: "turns each task into a markdown file",
	async run(splatesDir, fs) {
		// It reads and writes the records as formats 2 and 3 have them, never
		// through the code that reads today's, so it stays right as that code
		// moves on. Cut short, it runs again: a `.json` left is still the
		// record, and goes only once its `.md` is written.
		const store = `${splatesDir}/tasks`;
		const entries = await fs.readdir(store).catch(() => []);
		for (const entry of entries.filter((each) => /^\d+\.json$/.test(each))) {
			const from = `${store}/${entry}`;
			const record = await readJson(fs, from);
			if (record !== null) {
				await fs.write(
					`${store}/${entry.replace(/\.json$/, ".md")}`,
					encode(staged(record)),
				);
			}
			await fs.rm(from, { force: true });
		}
	},
};

type Json = Record<string, unknown>;

/** `record` with the stage a queued task is in; a started one is unchanged. */
function staged(record: Json): Json {
	if (record.status !== "queued") {
		return record;
	}
	return {
		...record,
		stage: record.assignee === undefined ? "backlog" : "ready",
	};
}

function encode(record: Json): string {
	const { text = "", ...fields } = record;
	const body = String(text).trim();
	return `---\n${JSON.stringify(fields, null, "\t")}\n---\n${body === "" ? "" : `${body}\n`}`;
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
