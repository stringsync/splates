import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Testing } from "./testing";

describe("toBail", () => {
	it("prints unexpected rejections as assertion failures with their original errors", async () => {
		await using deps = await Testing.open();
		await deps.fs.write(
			join(deps.root, "refusals.test.ts"),
			`import { test, expect } from "bun:test";
import { Exit } from ${JSON.stringify(import.meta.resolve("./exit"))};
import ${JSON.stringify(import.meta.resolve("./testing"))};
test("expected refusal", async () => {
  await expect(Promise.reject(new Exit("tests_failed", "gate failed", { task: "alpha" })))
    .toBail("tests_failed", { message: "gate failed", data: { task: "alpha" } });
});
test("unexpected error", async () => {
  await expect(Promise.reject(new Error("could not remove batch checkout")))
    .toBail("tests_failed");
});
test("unexpected value", async () => {
  await expect(Promise.reject("batch storage unavailable")).toBail("tests_failed");
});
`,
		);

		// A failing async custom matcher is reported directly by Bun, so inspect
		// its output in a child runner instead of nesting another matcher around it.
		const result = await deps.shell.run(
			"bun test ./refusals.test.ts --reporter=junit --reporter-outfile=refusals.xml",
			deps.root,
		);
		const report = await deps.fs.read(join(deps.root, "refusals.xml"));

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("1 pass");
		expect(result.stderr).toContain("2 fail");
		expect(result.stderr).toContain(
			"expected a tests_failed refusal, but it rejected with",
		);
		expect(result.stderr).toContain("error: could not remove batch checkout");
		expect(result.stderr).toContain(
			'rejected with "batch storage unavailable"',
		);
		expect(result.stderr).not.toContain("returned a promise that rejected");
		expect(report).toContain(
			"expected a tests_failed refusal, but it rejected with",
		);
		expect(report).toContain("could not remove batch checkout");
		expect(report).toContain("batch storage unavailable");
		expect(report).not.toContain("returned a promise that rejected");
	});
});
