import { describe, expect, test } from "bun:test";
import { NoopDraftFiles } from "./noop-draft-files";

describe("NoopDraftFiles", () => {
	test("loads no files, whatever was saved", async () => {
		const files = new NoopDraftFiles();

		files.save("c1", [new File(["a"], "a.txt")]);

		expect((await files.load()).size).toBe(0);
	});
});
