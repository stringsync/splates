import { describe, expect, test } from "bun:test";
import type { Decider } from "webappwiz/decide";
import type { Cleanup } from "webappwiz/dictate";
import {
	compareCleanups,
	LONGEST_PROMPT,
	sentPrompts,
	summarize,
} from "./cleanup-comparison";
import { CountingDecider } from "./counting-decider";

describe("cleanup comparison", () => {
	test("keeps what a person sent, each once", () => {
		const transcript = [
			sent("Fix the header"),
			sent([{ type: "text", text: "Make it blue" }]),
			sent("Fix the header", "typed"),
		].join("\n");
		expect(sentPrompts([transcript])).toEqual([
			"Fix the header",
			"Make it blue",
		]);
	});

	test("leaves out what a harness, a page or a paste put there", () => {
		const transcript = [
			sent("[ARBOR LANE 3]"),
			sent("<command-name>/model</command-name>"),
			sent("> **Which one?**\n- (a) This"),
			sent("You grade one run", "system"),
			sent("a".repeat(LONGEST_PROMPT + 1)),
			line({
				type: "user",
				isMeta: true,
				origin: { kind: "sdk" },
				message: { content: "meta" },
			}),
			line({ type: "assistant", message: { content: "reply" } }),
			sent([{ type: "tool_result", content: "ok" }]),
			"not json",
		].join("\n");
		expect(sentPrompts([transcript])).toEqual([]);
	});

	test("summarizes where the models disagree, what they left unsure and what failed", async () => {
		const compared = await compareCleanups(
			["hi", "yo"],
			{ loud, quiet, broken },
			(decider) => ({ shout: shouting(decider) }),
		);
		const [summary] = summarize(compared);
		expect(summary?.touched).toBe(2);
		expect(summary?.disagreed.map((each) => each.prompt)).toEqual(["hi", "yo"]);
		expect(summary?.changed).toEqual({ loud: 2, quiet: 0, broken: 0 });
		expect(summary?.unsure).toEqual({ loud: 0, quiet: 2, broken: 0 });
		expect(summary?.failed).toEqual({ loud: 0, quiet: 0, broken: 2 });
	});
});

function line(entry: object): string {
	return JSON.stringify(entry);
}

function sent(text: unknown, kind = "sdk"): string {
	return line({
		type: "user",
		origin: { kind },
		message: { role: "user", content: text },
	});
}

/** The deciders a test compares, each standing for a model by name. */
const loud: Decider = new CountingDecider();
const quiet: Decider = new CountingDecider();
const broken: Decider = new CountingDecider();

/** A cleanup that shouts on `loud`, leaves an unsure edit on `quiet`, and fails on `broken`. */
function shouting(decider: Decider): Cleanup {
	return {
		clean: async (text) => {
			if (decider === broken) {
				throw new Error("down");
			}
			return decider === loud
				? { text: text.toUpperCase(), edits: [] }
				: {
						text,
						edits: [
							{ type: "filler", start: 0, end: 1, text: "", probability: 0.5 },
						],
					};
		},
	};
}
