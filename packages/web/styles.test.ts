import { describe, expect, it } from "bun:test";
import { basename } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";

/** The names of the files Tailwind reads class names out of, as `build.ts` hands them to the scanner. */
async function scanned(): Promise<string[]> {
	const dir = import.meta.dir;
	const compiler = await compile(await Bun.file(`${dir}/styles.css`).text(), {
		base: dir,
		loadStylesheet: async () => ({ path: "", base: dir, content: "" }),
	});
	return new Scanner({ sources: compiler.sources }).files.map((file) =>
		basename(file),
	);
}

describe("styles.css", () => {
	it("reads every file of the page as a source for Tailwind", async () => {
		// A file left out compiles to a page missing its classes, with no error.
		const read = await scanned();
		const pages = [...new Bun.Glob("*.tsx").scanSync(import.meta.dir)].filter(
			(file) => !file.includes(".test."),
		);
		expect(pages.filter((file) => !read.includes(file))).toEqual([]);
	});

	it("reads the .ts files that hold class strings", async () => {
		const read = await scanned();
		expect(read).toEqual(
			expect.arrayContaining(["board.ts", "phone-rows.ts", "status-pill.ts"]),
		);
	});

	it("leaves test files out", async () => {
		expect((await scanned()).filter((file) => file.includes(".test."))).toEqual(
			[],
		);
	});
});
