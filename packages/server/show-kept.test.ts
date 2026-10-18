import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add, TaskDetails } from "./tasks";
import { Testing } from "./testing";

describe("a TaskDetails kept across reads", () => {
	let deps: Testing;
	let details: TaskDetails;
	let tree: string;
	const alpha = async () => details.get(await deps.service.find("alpha"));

	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
		tree = (await deps.service.find("alpha")).path;
		details = new TaskDetails({ fs: deps.fs });
	});

	afterEach(() => deps.disposeAsync());

	it("keeps what git said of a task until told git moved, and reads the rest anew", async () => {
		const before = (await alpha()).added ?? 0;

		await deps.fs.write(`${tree}/new.txt`, "one\ntwo\n");
		await deps.fs.write(`${tree}/SPLATES.md`, "# alpha\n\n## Goal\n\nmoved\n");
		const kept = await alpha();

		expect(kept.added).toBe(before);
		expect(kept.plan).toContain("moved");

		details.moved();

		expect((await alpha()).added).toBe(before + 2);
	});
});
