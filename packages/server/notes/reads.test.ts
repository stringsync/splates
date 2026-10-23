import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import type { ConversationState } from "../conversations";
import { conversation, message, tool } from "../fixtures";
import { Journal } from "../records";
import { MemoryStorage } from "../storage/testing";
import { NoteReads } from "./reads";
import { NoteUses } from "./uses";

describe("NoteReads", () => {
	let ROOT: string;
	let journal: Journal;
	let uses: NoteUses;
	let reads: NoteReads;
	let state: ConversationState;
	beforeEach(async () => {
		ROOT = await mkdtemp(join(tmpdir(), "splates-note-reads-"));
		const fs = new NodeFs();
		await fs.mkdir(`${ROOT}/notes`);
		for (const name of ["a", "b"]) {
			await fs.write(
				`${ROOT}/notes/${name}.md`,
				`---\ndescription: ${name}\n---\nbody`,
			);
		}
		const storage = new MemoryStorage();
		journal = new Journal(storage, 1000);
		uses = new NoteUses(storage);
		reads = new NoteReads({ fs, journal, uses, root: ROOT });
		state = conversation({
			id: "one",
			task: "fix",
			messages: [
				message(
					"agent",
					tool({ id: "old", command: `cat ${ROOT}/notes/b.md` }),
				),
			],
		});
		reads.follow(state);
	});
	afterEach(() => rm(ROOT, { recursive: true, force: true }));

	/** Gives the lookups `hear` started a moment, however far they got. */
	const settled = () => new Promise((done) => setTimeout(done, 50));
	/** The journal once it holds an event, waiting out lookups however slow. */
	const recorded = async () => {
		for (let tries = 0; tries < 60; tries++) {
			const events = await journal.tail(10);
			if (events.length > 0) {
				return events;
			}
			await settled();
		}
		return journal.tail(10);
	};

	it("writes a note read as its tool call comes, once per call, with its size and the context then, and none for what came before", async () => {
		state.usage.context = { used: 1200, size: 200_000 };
		const reading = tool({
			id: "t2",
			status: "in_progress",
			command: `cat ${ROOT}/notes/a.md`,
		});
		state.messages.push(
			message("agent", tool({ id: "t1", command: "splates notes" }), reading),
		);
		reads.hear(state, ROOT);
		reads.hear(state, ROOT);
		await settled();
		reading.status = "completed";
		reads.hear(state, ROOT);
		await recorded();
		await settled();
		const events = await journal.tail(10);
		expect(events).toEqual([
			expect.objectContaining({
				action: "note read",
				task: "fix",
				conversation: "one",
				path: "notes/a.md",
				hash: createHash("sha256")
					.update("---\ndescription: a\n---\nbody")
					.digest("hex"),
				tool: "t2",
				subagent: false,
				bytes: "---\ndescription: a\n---\nbody".length,
				context: 1200,
			}),
		]);
		expect(await uses.counts()).toEqual(new Map([["notes/a.md", 1]]));
	});

	it("looks again at a call as it fills in", async () => {
		const reading = tool({
			id: "t1",
			kind: "read",
			status: "pending",
			parent: "agent",
		});
		state.messages.push(message("agent", reading));
		reads.hear(state, ROOT);
		await settled();
		reading.paths = [`${ROOT}/notes/b.md`];
		reads.hear(state, ROOT);
		expect(await recorded()).toEqual([
			expect.objectContaining({ path: "notes/b.md", subagent: true }),
		]);
	});
});
