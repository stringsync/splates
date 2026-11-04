import { expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineSays, runsWholeSuite } from "./resources";

it("tells a whole-suite run from a scoped one", () => {
	expect(
		[
			"bun test",
			"bun test 2>&1 | tail -40",
			"cd x && bun test --timeout 30000",
			"npm test",
			"bun run test",
			"bun test src/math.test.ts",
			"bun test --changed 2>&1 | tail -40",
			"bun install",
			"git status",
		].map(runsWholeSuite),
	).toEqual([true, true, true, true, true, false, false, false, false]);
});

it("has `splates machine` print the reading, passing every other command on", async () => {
	const dir = await mkdtemp(join(tmpdir(), "machine-says-"));
	const splates = join(dir, "splates");
	await writeFile(splates, '#!/bin/sh\necho "real $*"\n', { mode: 0o755 });
	const run = async (argv: string[]): Promise<string> => {
		const child = Bun.spawn(argv, {
			env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
			stdout: "pipe",
		});
		const out = await new Response(child.stdout).text();
		expect(await child.exited).toBe(0);
		return out;
	};

	await machineSays(
		{ dir, write: async () => {}, run },
		"busy: CPU 96%, memory 70%",
	);

	expect(await run(["splates", "machine"])).toBe("busy: CPU 96%, memory 70%\n");
	expect(await run(["splates", "list", "--json"])).toBe("real list --json\n");
	await rm(dir, { recursive: true });
});
