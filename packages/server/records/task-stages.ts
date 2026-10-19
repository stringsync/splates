import type { Migration } from "./format";

/**
 * @internal Format 3 → 4: every task carries its stage the whole way. A
 * started task's stage becomes `running`, the stage it was in before kept as
 * `startedFrom`, and only a running task keeps a `status`.
 */
export const TASK_STAGES: Migration = {
	does: "gives every task the stage it is in, running ones included",
	async run(splatesDir, fs) {
		// It reads and writes the records as formats 3 and 4 have them, never
		// through the code that reads today's, so it stays right as that code
		// moves on. Each record is rewritten whole, and one already moved
		// comes out the same, so cut short, it runs again.
		const store = `${splatesDir}/tasks`;
		const entries = await fs.readdir(store).catch(() => []);
		for (const entry of entries.filter((each) => /^\d+\.md$/.test(each))) {
			const path = `${store}/${entry}`;
			const record = decode(await fs.read(path).catch(() => ""));
			if (record !== null) {
				await fs.write(path, encode(staged(record)));
			}
		}
	},
};

type Json = Record<string, unknown>;

/** `record` as format 4 has it. */
function staged(record: Json): Json {
	const { status, ...rest } = record;
	if (record.task === undefined) {
		return rest;
	}
	const before =
		typeof record.startedFrom === "string"
			? record.startedFrom
			: record.stage === "backlog" ||
					record.stage === "ready" ||
					record.stage === "queued"
				? record.stage
				: record.assignee === undefined
					? "backlog"
					: "ready";
	return {
		...rest,
		stage: "running",
		startedFrom: before,
		status: status === undefined || status === "queued" ? "working" : status,
	};
}

function decode(raw: string): Json | null {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
	if (match === null) {
		return null;
	}
	try {
		const fields = JSON.parse(match[1] ?? "") as unknown;
		return fields !== null && typeof fields === "object"
			? { ...(fields as Json), text: (match[2] ?? "").trim() }
			: null;
	} catch {
		return null;
	}
}

function encode(record: Json): string {
	const { text = "", ...fields } = record;
	const body = String(text).trim();
	return `---\n${JSON.stringify(fields, null, "\t")}\n---\n${body === "" ? "" : `${body}\n`}`;
}
