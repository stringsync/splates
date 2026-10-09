import { describe, expect, it } from "bun:test";
import { checkFormat, FORMAT } from "./format";
import { Testing } from "./testing";

describe("checkFormat", () => {
	it("stamps records from before formats as the current one", async () => {
		await using deps = await Testing.open();

		await checkFormat(deps.fs, deps.arborDir);

		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe(`${FORMAT}\n`);
	});

	it("leaves records in its own format as they are", async () => {
		await using deps = await Testing.open();
		await deps.fs.write(`${deps.arborDir}/format`, `${FORMAT}\n`);

		await checkFormat(deps.fs, deps.arborDir);

		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe(`${FORMAT}\n`);
	});

	it("refuses records a newer arbor wrote, and says to run the latest", async () => {
		await using deps = await Testing.open();
		await deps.fs.write(`${deps.arborDir}/format`, `${FORMAT + 1}\n`);

		await expect(checkFormat(deps.fs, deps.arborDir)).toBail("outdated", {
			message: [
				`format ${FORMAT + 1}, written by a newer arbor`,
				"bunx @webappwiz/arbor@latest",
			],
		});
		expect(await deps.fs.read(`${deps.arborDir}/format`)).toBe(
			`${FORMAT + 1}\n`,
		);
	});

	it("refuses a format file that names no format", async () => {
		await using deps = await Testing.open();
		await deps.fs.write(`${deps.arborDir}/format`, "soon\n");

		await expect(checkFormat(deps.fs, deps.arborDir)).toBail("usage", {
			message: ["names no format: 'soon'"],
		});
	});
});
