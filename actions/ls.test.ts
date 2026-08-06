import { expect, test } from "bun:test";
import { fixture } from "../lib/fixture";
import { create } from "./create";
import { ls } from "./ls";

test("ls lists tasks, survives a corrupt record, and flags orphans", async () => {
	const f = await fixture();
	await create(f.arbor, "alpha");
	await create(f.arbor, "beta");
	await f.fs.write(f.arbor.store.recordPath("broken"), "{not json");
	const beta = (await f.arbor.store.find("beta")).path;
	await f.fs.rm(beta, { recursive: true, force: true });

	await ls(f.arbor);
	expect(f.out()).toContain("alpha");
	expect(f.out()).toContain("unknown"); // the corrupt row, not a crash
	expect(f.out()).toContain("orphaned");

	f.log.clear();
	await ls(f.arbor, { json: true });
	const rows = JSON.parse(f.out());
	expect(rows.map((r: { task: string }) => r.task)).toEqual([
		"alpha",
		"beta",
		"broken",
	]);
	await f.cleanup();
});

test("ls says so plainly when there is nothing to list", async () => {
	const f = await fixture();

	await ls(f.arbor);

	expect(f.out()).toContain("no workstreams");
	await f.cleanup();
});
