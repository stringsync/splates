import { expect, it } from "bun:test";
import type { Step } from "../scenario";
import { opens, readBefore } from "./discovery";

const tool = (name: string, input: object): Step => ({
	kind: "tool",
	name,
	input: JSON.stringify(input),
	output: null,
});

const read = tool("Read", { file_path: "/r/references/queue.md" });
const act = tool("Bash", { command: "splates task add x" });
const first = opens("references/queue.md");
const second = (text: string) => text.includes("task add");

it("tells a read before an action from one after it, or none", () => {
	expect([
		readBefore([read, act], first, second),
		readBefore([act, read], first, second),
		readBefore([read], first, second),
		readBefore([act], first, second),
		readBefore(
			[tool("Bash", { command: "cat references/queue.md" }), act],
			first,
			second,
		),
	]).toEqual([true, false, true, false, true]);
});
