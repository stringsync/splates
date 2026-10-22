import { beforeEach, describe, expect, it } from "bun:test";

describe("the page's motion", () => {
	let moving: string[];

	beforeEach(async () => {
		const dir = import.meta.dir;
		const files = [...new Bun.Glob("**/*.tsx").scanSync(dir)].filter(
			(file) => !file.includes(".test.") && !file.includes("node_modules"),
		);
		const texts = await Promise.all(
			files.map((file) => Bun.file(`${dir}/${file}`).text()),
		);
		moving = files.filter((_, at) =>
			/animate-(spin|pulse|ping)/.test(texts[at] ?? ""),
		);
	});

	it("spins only GivingUp and the working marks", () => {
		// Rows, buttons and dots that spin or pulse each draw the eye at once;
		// what they mark shows still, dimmed or in words instead. The working
		// marks of the sidebar, inbox and board spin, or a frozen agent looks alike.
		expect(moving.sort()).toEqual([
			"background.tsx",
			"freshness.tsx",
			"mark.tsx",
		]);
	});
});
