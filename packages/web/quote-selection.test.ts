import { expect, test } from "bun:test";
import { quoted } from "./quote-selection";

test("quoted prefixes each line and leaves room to reply", () => {
	expect(quoted("one\n\ntwo\n")).toBe("> one\n>\n> two\n\n");
});
