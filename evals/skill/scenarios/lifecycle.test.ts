import { expect, it } from "bun:test";
import { reported, scenarios, startsBefore } from "./lifecycle";

it("reads a Merged card from a reply", () => {
	const reply = "Done.\n\n## ✅ Merged sample onto main\n\nvalue is two.";
	expect(reported(reply, "merged", "sample")).toBe(true);
	expect(reported(reply, "merged", "other")).toBe(false);
	expect(reported(reply, "removed")).toBe(false);
});

it("orders steps by first match", () => {
	const steps = ["ls", "splates add x", "cat value.txt"];
	expect(startsBefore(steps, /splates add/, /value\.txt/)).toBe(true);
	expect(
		startsBefore(
			["cat value.txt", "splates add x"],
			/splates add/,
			/value\.txt/,
		),
	).toBe(false);
	expect(startsBefore(["ls"], /splates add/, /value\.txt/)).toBe(false);
});

it("passes recover-budget's retry card only as the skill shapes it", async () => {
	const check = scenarios
		.find((each) => each.id === "lifecycle/recover-budget")
		?.checks?.find((each) => each.id === "retry-card");
	const graded = (reply: string) =>
		check?.test({ reply, commands: [], transcript: [] } as never);
	expect(
		await graded(
			"## 🔐 Permission: run command: more merge attempts for sample\n\n`splates retry sample`\n\n- Each attempt failed `value is never wrong`.",
		),
	).toBe(true);
	expect(
		await graded(
			"To continue, run this yourself:\n\n```\nsplates retry sample\n```",
		),
	).toBe(false);
});
