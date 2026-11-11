import { describe, expect, test } from "bun:test";
import { NoopAuthor } from "./noop-author";

describe("NoopAuthor", () => {
	test("names no author", async () => {
		const author = new NoopAuthor();

		expect(await author.author()).toBeNull();
	});
});
