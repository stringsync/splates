import { beforeEach, describe, expect, it } from "bun:test";

describe("styles.css", () => {
	let listed: string[];
	let pages: string[];

	beforeEach(async () => {
		const dir = import.meta.dir;
		const styles = await Bun.file(`${dir}/styles.css`).text();
		listed = [...styles.matchAll(/^@source "\.\/(.+\.tsx)";$/gm)].map(
			([, file]) => file ?? "",
		);
		pages = [...new Bun.Glob("*.tsx").scanSync(dir)].filter(
			(file) => !file.includes(".test."),
		);
	});

	it("names every file of the page as a source for Tailwind", () => {
		// A file left off compiles to a page missing its classes, with no error.
		// `main.tsx` only mounts the app, and has no classes to find.
		expect(listed.sort()).toEqual(
			pages.filter((file) => file !== "main.tsx").sort(),
		);
	});
});
