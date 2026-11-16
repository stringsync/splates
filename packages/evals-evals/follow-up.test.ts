import { describe, expect, it } from "bun:test";
import { continueCommand, runAgent } from "./agents";

describe("follow-up turns", () => {
	// A fake agent: each call prints one opencode text event and a step, and
	// the first argument names the turn.
	const say = (text: string) =>
		`echo '{"type":"text","part":{"text":"${text}"}}'; echo '{"type":"step_finish","part":{"cost":0.5,"tokens":{"input":1,"output":1}}}'`;
	const turn = (text: string) => ["sh", "-c", say(text)];
	const options = { cwd: ".", env: {} as Record<string, string> };

	it("runs once without a follow-up", async () => {
		const run = await runAgent(turn("Now I will draw."), "opencode", options);
		expect(run.reply).toBe("Now I will draw.");
		expect(run.turns).toBe(1);
	});

	it("resumes until the answer is final and sums every turn", async () => {
		const run = await runAgent(turn("Now I will draw."), "opencode", {
			...options,
			followUp: {
				turns: 3,
				argv: turn("Final diagram."),
				done: (each) => each.reply.startsWith("Final"),
			},
		});
		expect(run.reply).toBe("Final diagram.");
		expect(run.transcript.length).toBe(2);
		expect(run.turns).toBe(2);
		expect(run.usd).toBe(1);
		expect(run.tokens).toBe(4);
	});

	it("stops at the cap when no turn gives a final answer", async () => {
		const run = await runAgent(turn("Hmm."), "opencode", {
			...options,
			followUp: { turns: 2, argv: turn("Hmm."), done: () => false },
		});
		expect(run.turns).toBe(3);
	});

	it("does not resume a run that is done", async () => {
		const run = await runAgent(turn("Answer."), "opencode", {
			...options,
			followUp: { turns: 2, argv: turn("More."), done: () => true },
		});
		expect(run.turns).toBe(1);
	});

	it("does not resume a failed turn", async () => {
		const run = await runAgent(["sh", "-c", "exit 3"], "opencode", {
			...options,
			followUp: { turns: 2, argv: turn("More."), done: () => false },
		});
		expect(run.error).toContain("exited 3");
		expect(run.turns).toBe(0);
	});

	it("resumes OpenCode with --continue and no other agent", () => {
		const { argv } = continueCommand({ agent: "opencode" }, "Go on.");
		expect(argv.slice(-2)).toEqual(["--continue", "Go on."]);
		expect(() => continueCommand({ agent: "claude" })).toThrow(
			"no follow-up turns for agent claude",
		);
	});
});
