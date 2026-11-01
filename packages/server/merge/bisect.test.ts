import { beforeEach, describe, expect, it } from "bun:test";
import type { Git } from "../git";
import { bisect, pinByFile } from "./bisect";
import type { MergeGate } from "./gate";
import type { Member } from "./line";

describe("bisect and pinByFile", () => {
	let stack: Member[];

	beforeEach(() => {
		stack = members();
	});

	it("finds the first failing member in at most two gates", async () => {
		const ran: string[] = [];
		const found = await bisect(
			{ gate: gateFailingFrom(stack, "c", ran) },
			{ cwd: "/", task: "a" },
			stack,
		);
		expect(found?.member.task).toBe("c");
		expect(ran.length).toBeLessThanOrEqual(2);
	});

	it("finds the leader when the first prefix already fails", async () => {
		const found = await bisect(
			{ gate: gateFailingFrom(stack, "a", []) },
			{ cwd: "/", task: "a" },
			stack,
		);
		expect(found?.member.task).toBe("a");
	});

	it("pins on the one member touching a named file", async () => {
		const found = await pinByFile(diffs(), "/", stack, "lint: src/b.ts:3");
		expect(found?.member.task).toBe("b");
	});

	it("pins nothing when no member's file is named", async () => {
		expect(await pinByFile(diffs(), "/", stack, "timeout")).toBeNull();
	});
});

function members(): Member[] {
	return ["a", "b", "c", "d"].map((task) => ({
		task,
		onto: `onto-${task}`,
		head: `head-${task}`,
	}));
}

function gateFailingFrom(
	stack: Member[],
	culprit: string,
	ran: string[],
): MergeGate {
	return {
		checkout: async (_cwd: string, at: string) => ({
			path: at,
			[Symbol.asyncDispose]: async () => {},
		}),
		run: async (path: string) => {
			ran.push(path);
			const failing = stack.findIndex((each) => each.task === culprit);
			const at = stack.findIndex((each) => each.head === path);
			return {
				exitCode: at >= failing ? 1 : 0,
				stdout: "",
				stderr: "",
				xml: "",
			};
		},
	} as unknown as MergeGate;
}

function diffs(): Git {
	return {
		run: async (_cwd: string, _diff: string, _flag: string, onto: string) => ({
			code: 0,
			stdout: onto === "onto-b" ? "src/b.ts\n" : "src/other.ts\n",
		}),
	} as unknown as Git;
}
