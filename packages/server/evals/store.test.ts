import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalStore, REMARKS_FILE } from "./store";

let directory: string;
let store: EvalStore;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "eval-store-test-"));
	store = new EvalStore(directory);
	await Bun.write(
		join(directory, "nightly", "batch.json"),
		JSON.stringify({
			format: "splates-evals/1",
			startedAt: "2026-10-26T12:00:00.000Z",
			cells: [{ id: "c1", case: "a/b", target: { model: "m" } }],
		}),
	);
});

afterEach(() => rm(directory, { recursive: true, force: true }));

it("shows a batch's remarks with its grid, and not in the list", async () => {
	expect((await store.grid("nightly"))?.remarks).toBeUndefined();

	await writeFile(
		join(directory, "nightly", REMARKS_FILE),
		"Skill: too faint\n",
	);

	expect((await store.grid("nightly"))?.remarks).toBe("Skill: too faint\n");
	expect(await store.batches()).toEqual([
		expect.not.objectContaining({ remarks: expect.anything() }),
	]);
});
