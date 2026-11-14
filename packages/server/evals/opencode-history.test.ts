import { afterEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvalStore } from "./store";

let directory: string;
afterEach(() => rm(directory, { recursive: true, force: true }));

it("still lists a recorded batch whose agent is opencode", async () => {
	directory = await mkdtemp(join(tmpdir(), "eval-opencode-history-"));
	await Bun.write(
		join(directory, "old", "batch.json"),
		JSON.stringify({
			format: "splates-evals/1",
			startedAt: "2026-10-26T12:00:00.000Z",
			cells: [
				{
					id: "c1",
					case: "a/b",
					target: { agent: "opencode", model: "opencode-go/kimi-k3" },
				},
			],
		}),
	);
	await Bun.write(
		join(directory, "old", "results.jsonl"),
		`${JSON.stringify({ cell: "c1", status: "pass" })}\n`,
	);

	const store = new EvalStore(directory);
	const [batch] = await store.batches();

	expect(batch?.id).toBe("old");
	expect(batch?.cells).toBe(1);
	expect(batch?.targets.map((target) => target.agent)).toEqual(["opencode"]);
	expect((await store.grid("old"))?.targets[0]?.model).toBe(
		"opencode-go/kimi-k3",
	);
});
