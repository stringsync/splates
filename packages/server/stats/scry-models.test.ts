import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScryModelsReader } from "./scry-models";

test("names scry's defaults when no config sets a model", async () => {
	const dir = mkdtempSync(join(tmpdir(), "scry-models-"));
	const models = await new ScryModelsReader(dir, dir).read();
	expect(models.som[0]).toEqual({
		effort: "default",
		model: "clef",
		from: null,
	});
});

test("a bare name from a config replaces the role's models", async () => {
	const dir = mkdtempSync(join(tmpdir(), "scry-models-"));
	writeFileSync(
		join(dir, "scry.config.ts"),
		'export default { models: { som: "jev-latest" } };',
	);
	const models = await new ScryModelsReader(dir, dir).read();
	expect(models.som).toEqual([
		{
			effort: "default",
			model: "jev-latest",
			from: join(dir, "scry.config.ts"),
		},
	]);
	expect(models.llm[0]?.from).toBeNull();
});
