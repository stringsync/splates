import { expect, it } from "bun:test";
import { stretches } from "@splates/server/plans";
import { shortPlan } from "./proposing";

const card = (body: string) =>
	`## 📝 Plan: retry failed scans\n\n${body}\n\n1. Do you approve retrying failed scans?\n   - (a) Yes, approve it\n   - (b) No\n`;

const bodyOf = (reply: string) => {
	const plan = stretches(reply).find((each) => each.type === "plan");
	return plan?.type === "plan" ? plan.plan.body : "";
};

const lines =
	"**Goal:** A failed scan leaves an upload stuck.\n**After:** Failed scans retry, then land in a failures table.\n**Approach:** The worker retries and dead-letters what still fails.";

it("passes the prescribed shape, a diagram aside", () => {
	expect(
		shortPlan(bodyOf(card(`${lines}\n\n\`\`\`d2\na -> b\nb -> c\n\`\`\``))),
	).toBe(true);
});

it("fails a plan with a step list", () => {
	expect(
		shortPlan(bodyOf(card(`${lines}\n\n- add a table\n- add a queue`))),
	).toBe(false);
});

it("fails a plan missing its Goal line", () => {
	expect(shortPlan(bodyOf(card(lines.split("\n").slice(1).join("\n"))))).toBe(
		false,
	);
});

it("fails a plan over 200 words of prose", () => {
	expect(shortPlan(bodyOf(card(`${lines}\n\n${"word ".repeat(200)}`)))).toBe(
		false,
	);
});
