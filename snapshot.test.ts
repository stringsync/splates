import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { basename, dirname } from "node:path";
import { snapshot } from "./snapshot";
import { Testing } from "./testing";

describe("snapshot", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("writes a repo under home with ~", async () => {
		const { path } = await snapshot({ ...deps, home: dirname(deps.root) });

		expect(path).toBe(`~/${basename(deps.root)}`);
	});

	it("writes home itself as ~", async () => {
		const { path } = await snapshot({ ...deps, home: deps.root });

		expect(path).toBe("~");
	});

	it("leaves a repo outside home, or one only sharing its prefix, whole", async () => {
		const { path } = await snapshot({ ...deps, home: deps.root.slice(0, -1) });

		expect(path).toBe(deps.root);
		expect((await snapshot(deps)).path).toBe(deps.root);
	});
});
