import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeControl } from "./build";

test("writeControl writes the script, stylesheet and shell", async () => {
	const dir = await mkdtemp(join(tmpdir(), "rec-control-"));
	await writeControl(dir);
	expect((await readFile(`${dir}/control.js`, "utf8")).length).toBeGreaterThan(
		1000,
	);
	expect((await readFile(`${dir}/control.css`, "utf8")).length).toBeGreaterThan(
		100,
	);
	expect(await readFile(`${dir}/index.html`, "utf8")).toContain("<");
}, 60000);
