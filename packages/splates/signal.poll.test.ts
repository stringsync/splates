import { describe, expect, test } from "bun:test";
import { checkDescription, pollScript } from "./signal";

const run = (script: string) =>
	Bun.spawnSync(["sh", "-c", script]).stdout.toString();

test("a single argument is the script verbatim", () => {
	expect(pollScript(["echo a | head -1"])).toBe("echo a | head -1");
});

test("several arguments keep spaces and pipes intact", () => {
	const script = pollScript(["sh", "-c", "echo 'a b' | head -1; echo $0"]);
	expect(run(script)).toBe("a b\nsh\n");
});

describe("checkDescription", () => {
	test("refuses a terse label and names what a good one holds", () => {
		expect(checkDescription("stack up")).toContain("at least 5 words");
	});
	test("accepts a plain sentence", () => {
		expect(
			checkDescription("The mdom release is on npm, so vexml can adopt it."),
		).toBeUndefined();
	});
});
