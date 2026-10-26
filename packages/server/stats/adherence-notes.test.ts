import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { conversation, message, tool } from "../fixtures";
import { FsStorage } from "../storage";
import { Adherence } from "./adherence";

const AT = "2026-10-14T10:00:00.000Z";

describe("Adherence with project notes", () => {
	let root: string;
	let adherence: Adherence;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "splates-notes-adherence-"));
		const fs = new NodeFs();
		adherence = new Adherence(new FsStorage(`${root}/.splates`, fs), fs);
		await fs.mkdir(`${root}/context`, { recursive: true });
		await fs.write(
			`${root}/splates.config.ts`,
			'export default { notesDir: "context" };',
		);
		await fs.write(
			`${root}/context/exports.md`,
			"---\ndescription: Why exports are explicit\n---\nOne entry per module.",
		);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("judges notes in the conversation's project, honoring the configured directory", async () => {
		const state = conversation({
			messages: [
				message("user", "fix the upload"),
				message("agent", tool({ kind: "edit", paths: ["src/upload.ts"] })),
			],
		});
		await adherence.judge(state, root, AT);
		expect((await adherence.list())[0]?.scores["notes-first"]).toEqual({
			passed: 0,
			failed: 1,
		});

		await adherence.judge(state, `${root}/other-project`, AT);
		expect((await adherence.list())[0]?.scores["notes-first"]).toEqual({
			passed: 1,
			failed: 0,
		});

		state.messages.splice(
			1,
			0,
			message("agent", tool({ command: "splates notes" })),
		);
		await adherence.judge(state, root, AT);
		expect((await adherence.list())[0]?.scores["notes-first"]).toEqual({
			passed: 1,
			failed: 0,
		});
	});
});
