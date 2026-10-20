import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { conversation, message, tool } from "../fixtures";
import { MemoryStorage } from "../storage/testing";
import { NoteUses } from "./uses";

describe("NoteUses", () => {
	let ROOT: string;
	beforeEach(async () => {
		ROOT = await mkdtemp(join(tmpdir(), "splates-note-uses-"));
		const fs = new NodeFs();
		await fs.mkdir(`${ROOT}/notes`);
		for (const name of ["a", "b"]) {
			await fs.write(
				`${ROOT}/notes/${name}.md`,
				`---\ndescription: ${name}\n---\nbody`,
			);
		}
	});
	afterEach(() => rm(ROOT, { recursive: true, force: true }));

	it("counts each conversation that read a note once, ignoring listings and edits", async () => {
		const uses = new NoteUses(new MemoryStorage(), new NodeFs());
		const reads = conversation({
			id: "one",
			messages: [
				message("agent", tool({ command: "splates notes" })),
				message("agent", tool({ command: `cat ${ROOT}/notes/a.md` })),
				message("agent", tool({ command: `cat ${ROOT}/notes/a.md` })),
				message("agent", tool({ kind: "edit", paths: [`${ROOT}/notes/b.md`] })),
			],
		});
		await uses.record(reads, ROOT);
		await uses.record(reads, ROOT);
		await uses.record(
			conversation({
				id: "two",
				messages: [
					message(
						"agent",
						tool({ kind: "read", paths: [`${ROOT}/notes/a.md`] }),
					),
				],
			}),
			ROOT,
		);
		expect(await uses.counts()).toEqual(new Map([["notes/a.md", 2]]));
	});
});
