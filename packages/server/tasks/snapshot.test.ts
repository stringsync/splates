import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, dirname } from "node:path";
import { Testing } from "../testing";
import { add } from "./add";
import { fingerprint, snapshot } from "./snapshot";

describe("snapshot", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("names the project by the slug it was given", async () => {
		expect((await snapshot({ ...deps, project: "mine" })).project).toBe("mine");
	});

	it("writes a repo under home with ~", async () => {
		const { path } = await snapshot({
			project: "repo",
			...deps,
			home: dirname(deps.root),
		});

		expect(path).toBe(`~/${basename(deps.root)}`);
	});

	it("writes home itself as ~", async () => {
		const { path } = await snapshot({
			project: "repo",
			...deps,
			home: deps.root,
		});

		expect(path).toBe("~");
	});

	it("leaves a repo outside home, or one only sharing its prefix, whole", async () => {
		const { path } = await snapshot({
			project: "repo",
			...deps,
			home: deps.root.slice(0, -1),
		});

		expect(path).toBe(deps.root);
		expect((await snapshot({ project: "repo", ...deps })).path).toBe(deps.root);
	});
	it("exposes confirmed running batches and fingerprints their membership and merge progress", async () => {
		await add(deps, "alpha");
		await add(deps, "beta");
		await (await deps.service.find("alpha")).save({
			gate: "running",
			mergeSince: new Date().toISOString(),
		});
		await (await deps.service.find("beta")).save({
			gate: "running",
			mergeSince: new Date().toISOString(),
		});
		const records = deps.storage.collection("merge-batch");
		await records.write(
			"invite:beta",
			JSON.stringify({ leader: "alpha", onto: "tip" }),
		);
		await records.write(
			"stacked:beta",
			JSON.stringify({ onto: "tip", head: "beta" }),
		);
		const read = await snapshot({ ...deps, project: "repo" });
		expect(read.mergeBatches).toEqual([["alpha", "beta"]]);
		expect(fingerprint(read)).not.toBe(
			fingerprint({ ...read, mergeBatches: [] }),
		);
		const queued = {
			...read,
			tasks: read.tasks.map((task) => ({ ...task, gate: "queued" as const })),
		};
		expect(fingerprint(read)).not.toBe(fingerprint(queued));
		await records.write("result:beta", JSON.stringify({ kind: "dissolved" }));
		expect((await snapshot({ ...deps, project: "repo" })).mergeBatches).toEqual(
			[],
		);
	});
});
