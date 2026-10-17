import { describe, expect, it } from "bun:test";
import { EDITORS } from "./editors";

describe("editors", () => {
	it("open the tree as the window and the file in it", () => {
		expect(EDITORS.map((editor) => editor.argv("/t", "/t/a.ts", 12))).toEqual([
			["zed", "/t", "/t/a.ts:12"],
			["code", "/t", "-g", "/t/a.ts:12"],
			["cursor", "/t", "-g", "/t/a.ts:12"],
		]);
		expect(EDITORS.map((editor) => editor.argv("/t", "/t", null))).toEqual([
			["zed", "/t"],
			["code", "/t"],
			["cursor", "/t"],
		]);
	});
});
