import type { Storage } from "../storage";
import type { Migration } from "./format";

/**
 * @internal Format 5 → 6: the stages `backlog` and `ready` become one,
 * `available`, and a task no longer records whether it was groomed: that is
 * whether it sits in a lane. A started task's `startedFrom` follows, and
 * the `groomed` and `sorted` marks go.
 */
export const AVAILABLE_STAGE: Migration = {
	does: "merges the backlog and ready stages into available",
	async run(_splatesDir, _fs, into) {
		if (into?.storage === undefined) {
			throw new Error("no database to migrate the tasks in");
		}
		// It reads and writes the records as formats 5 and 6 have them, never
		// through the code that reads today's, so it stays right as that code
		// moves on. Each record is rewritten whole, and one already moved
		// comes out the same, so cut short, it runs again.
		const storage: Storage = await into.storage();
		for (const key of ["tasks", "tasks/removed"]) {
			const records = storage.collection(key);
			for (const name of await records.list()) {
				if (!/^\d+\.md$/.test(name)) {
					continue;
				}
				const record = decode((await records.read(name)) ?? "");
				if (record !== null) {
					await records.write(name, encode(available(record)));
				}
			}
		}
	},
};

type Json = Record<string, unknown>;

/** `record` as format 6 has it. */
function available(record: Json): Json {
	const { groomed: _, sorted: __, ...rest } = record;
	const name = (stage: unknown) =>
		stage === "backlog" || stage === "ready" ? "available" : stage;
	return {
		...rest,
		...(rest.stage === undefined ? {} : { stage: name(rest.stage) }),
		...(rest.startedFrom === undefined
			? {}
			: { startedFrom: name(rest.startedFrom) }),
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
