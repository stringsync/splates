import { expect, it } from "bun:test";
import {
	DEFAULT_JUDGE,
	judgeFor,
	judgeName,
	judgePickOf,
	judgePrompt,
	verdictOf,
} from "./judge";

it("reads the judge's JSON, and fails an answer it cannot read", () => {
	expect(verdictOf('Sure: {"pass": true, "reason": "scoped"}', 0.01)).toEqual({
		pass: true,
		reason: "scoped",
		usd: 0.01,
	});
	expect(verdictOf("I think so", null).pass).toBe(false);
});

it("reads a judge answer whose reason holds stray backslash escapes", () => {
	const text =
		'{"pass": true, "reason": "ships \\`@acme/dates\\` patch, path C:\\\\x \\"q\\""}';
	expect(verdictOf(text, null)).toEqual({
		pass: true,
		reason: 'ships `@acme/dates` patch, path C:\\x "q"',
		usd: null,
	});
});

it("keeps early image calls visible when inline image payloads would fill the transcript", () => {
	const prompt = judgePrompt({
		requirement: "Inspect screenshots",
		rubric: "Check all three",
		message: "Review the recording",
		reply: "Reviewed",
		transcript: [
			{
				kind: "tool",
				name: "Read",
				input: '{"file_path":"slices/12/shot-at.png"}',
				output: JSON.stringify({
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "a".repeat(80000),
					},
				}),
			},
			{
				kind: "tool",
				name: "ReadMediaFile",
				input: '{"path":"slices/305/shot-at.png"}',
				output: JSON.stringify([
					{
						type: "image_url",
						imageUrl: { url: `data:image/png;base64,${"b".repeat(80000)}` },
					},
				]),
			},
			{
				kind: "tool",
				name: "Read",
				input: '{"file_path":"slices/570/shot-at.png"}',
				output: "image loaded",
			},
		],
	});
	expect(prompt).toContain('TOOL Read: {"file_path":"slices/12/shot-at.png"}');
	expect(prompt).toContain(
		'TOOL ReadMediaFile: {"path":"slices/305/shot-at.png"}',
	);
	expect(prompt).toContain('TOOL Read: {"file_path":"slices/570/shot-at.png"}');
	expect(prompt).not.toContain("a".repeat(100));
	expect(prompt.length).toBeLessThan(4000);
});

it("retains each action when a text result alone exceeds the transcript budget", () => {
	const prompt = judgePrompt({
		requirement: "Inspect",
		rubric: "Check",
		message: "Review",
		reply: "Done",
		transcript: [
			{
				kind: "tool",
				name: "view_image",
				input: '{"path":"early.png"}',
				output: "loaded",
			},
			{
				kind: "tool",
				name: "shell",
				input: "cat long.log",
				output: "x".repeat(100000),
			},
			{
				kind: "tool",
				name: "view_image",
				input: '{"path":"late.png"}',
				output: "loaded",
			},
		],
	});
	expect(prompt).toContain('"early.png"');
	expect(prompt).toContain("TOOL shell: cat long.log");
	expect(prompt).toContain('"late.png"');
	expect(prompt).toContain("[step truncated]");
});

it("reads a Claude judge pick, and refuses any other", () => {
	expect(judgePickOf("claude:opus@high")).toEqual({
		model: "opus",
		effort: "high",
	});
	expect(judgeName(judgePickOf("claude:sonnet"))).toBe("claude:sonnet");
	expect(() => judgePickOf("codex:gpt-5")).toThrow("a judge is claude:");
	expect(() => judgePickOf("claude")).toThrow("a judge is claude:");
});

it("judges by the scenario's pick, else the default", () => {
	expect(judgeFor({ judgeWith: "claude:haiku" })).toEqual({
		model: "haiku",
	});
	expect(judgeFor({})).toEqual(DEFAULT_JUDGE);
});
