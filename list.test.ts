import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { color } from "webappwiz/log";
import { add } from "./add";
import { list } from "./list";
import { Testing } from "./testing";

describe("list", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("lists tasks, survives a corrupt record, and flags orphans", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");
		await deps.fs.write(deps.service.recordPath("broken"), "{not json");
		const beta = (await deps.service.find("beta")).path;
		await deps.fs.rm(beta, { recursive: true, force: true });

		await list(deps);

		expect(deps.out()).toContain("alpha");
		expect(deps.out()).toContain("unknown"); // the corrupt row, not a crash
		expect(deps.out()).toContain("orphaned");
		expect(color.strip(deps.out())).toContain("+0 -0");

		deps.log.clear();
		await list(deps, { json: true });
		const rows = JSON.parse(deps.out());
		expect(rows.map((fixture: { task: string }) => fixture.task)).toEqual([
			"alpha",
			"beta",
			"broken",
		]);
	});

	it("says so plainly when there is nothing to list", async () => {
		await list(deps);

		expect(deps.out()).toContain("no tasks");
	});
});
