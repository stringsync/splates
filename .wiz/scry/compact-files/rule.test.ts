import { describe, expect, it } from "bun:test";
import { Cases, SourceFile } from "@webappwiz/scry";
import CompactFiles from "./rule";

const cases = await Cases.load(import.meta.dir);

/** A file of the given lines, each on its own line. */
function fileOf(...lines: string[]): SourceFile {
	return new SourceFile("table.ts", `${lines.join("\n")}\n`);
}

/** That many lines of code, each declaring a constant. */
function code(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `const a${i} = ${i};`);
}

describe("compact-files", () => {
	const rule = new CompactFiles();

	it.each(cases.bad)("flags $name", async ({ file }) => {
		expect(await rule.check(file)).not.toEqual([]);
	});

	it.each(cases.good)("passes $name", async ({ file }) => {
		expect(await rule.check(file)).toEqual([]);
	});

	it("flags the 500th line of code, once", async () => {
		const file = fileOf("// a table", "", ...code(600));

		expect(await rule.check(file)).toEqual([
			{
				line: 502,
				message:
					"This file has 600 lines of code, and a file stays under 500. Move out a responsibility it holds, into a file named for what that does; never numbered parts or a helpers file. When the file does one thing, excuse it with scry-ignore-file and why.",
				confidence: 1,
			},
		]);
	});

	it("passes 499 lines of code", async () => {
		expect(await rule.check(fileOf(...code(499)))).toEqual([]);
	});

	it("skips lines inside a block comment, and blank ones", async () => {
		const file = fileOf(
			"/*",
			...code(300).map((line) => ` * ${line}`),
			" */",
			"",
			...code(499),
		);

		expect(await rule.check(file)).toEqual([]);
	});

	it("counts a line with code and a comment", async () => {
		const file = fileOf(...code(499), "export {}; // the end");

		expect(await rule.check(file).then((found) => found.length)).toBe(1);
	});

	it("counts code after a block comment ends on its line", async () => {
		const file = fileOf(...code(499), "/* one", "two */ const last = 1;");

		expect(await rule.check(file).then((found) => found.length)).toBe(1);
	});

	it("counts a template literal that looks like a comment", async () => {
		const file = fileOf(
			...code(497),
			"const doc = `",
			"// not a comment",
			"`;",
		);

		expect(await rule.check(file).then((found) => found.length)).toBe(1);
	});

	it("takes its limit from its options", async () => {
		const strict = new CompactFiles(undefined, { limit: 3 });

		expect([
			await strict.check(fileOf(...code(2))),
			(await strict.check(fileOf(...code(3)))).map((found) => found.line),
		]).toEqual([[], [3]]);
	});

	it("leaves tests alone", async () => {
		const file = new SourceFile("cart.test.tsx", `${code(600).join("\n")}\n`);

		expect(await rule.check(file)).toEqual([]);
	});
});
