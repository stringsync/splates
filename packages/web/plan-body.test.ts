import { describe, expect, it } from "bun:test";
import { leadsWithActions, planFields, planTags } from "./plan-body";

describe("planFields", () => {
	it("splits fields, keeping the lines under each and what follows a heading", () => {
		const plan = planFields(
			[
				"**Goal:** Ship it.",
				"**Details:**",
				"- one",
				"- two",
				"",
				"### Flow",
				"",
				"```d2",
				"a -> b",
				"```",
			].join("\n"),
		);
		expect(plan).toEqual({
			lead: "",
			fields: [
				{ label: "Goal", body: "Ship it." },
				{ label: "Details", body: "- one\n- two" },
			],
			rest: "### Flow\n\n```d2\na -> b\n```",
		});
	});

	it("leaves a bold label inside a code block alone", () => {
		const plan = planFields(
			["**Goal:** Ship it.", "```", "**Tags:** not a field", "```"].join("\n"),
		);
		expect(plan?.fields.map((field) => field.label)).toEqual(["Goal"]);
	});

	it("is null for a body with no fields", () => {
		expect(planFields("### Approach\n\nRename it Pause.")).toBeNull();
	});
});

describe("planTags", () => {
	it("reads one tag per item, with or without a reason", () => {
		expect(planTags("- Clean revert: nothing stored\n- Evals")).toEqual([
			{ name: "Clean revert", why: "nothing stored" },
			{ name: "Evals", why: "" },
		]);
	});

	it("reads tags written on one line", () => {
		expect(planTags("Small, CLI")).toEqual([
			{ name: "Small", why: "" },
			{ name: "CLI", why: "" },
		]);
	});
});

describe("leadsWithActions", () => {
	it("is true when every bullet leads with a bold action", () => {
		expect(
			leadsWithActions(
				"- **Shrink the buttons** to 32px\n- **Keep the tap area** as is",
			),
		).toBe(true);
	});

	it("is false when any bullet has no bold lead, or there are none", () => {
		expect(
			leadsWithActions("- **Shrink the buttons** to 32px\n- keep the rest"),
		).toBe(false);
		expect(leadsWithActions("Plain prose.")).toBe(false);
	});
});
