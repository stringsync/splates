import { afterEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import {
	leadsWithActions,
	PlanBody,
	planFields,
	planTags,
	tagLook,
} from "./plan-body";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

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

describe("tagLook", () => {
	const green = "text-emerald-600 dark:text-emerald-400";
	const yellow = "text-amber-600 dark:text-amber-400";
	const red = "text-red-600 dark:text-red-400";
	const gray = "text-muted-foreground";

	it("colors Size green/yellow/red, Paid yellow, hard risks red, and everything else gray", () => {
		const tags = [
			"Small",
			"Medium",
			"Complex",
			"Paid",
			"One-way",
			"Invasive",
			"Breaking",
			"Security",
			"Reversible",
			"Cleanup",
			"Self-contained",
			"Targeted",
			"UI",
			"CLI",
			"Server",
			"Database",
			"Fullstack",
			"DevOps",
			"Evals",
			"Skill",
			"Library",
			"Unknown",
		];
		expect(tags.map((name) => [name, tagLook(name).tone])).toEqual([
			["Small", green],
			["Medium", yellow],
			["Complex", red],
			["Paid", yellow],
			["One-way", red],
			["Invasive", red],
			["Breaking", red],
			["Security", red],
			["Reversible", gray],
			["Cleanup", gray],
			["Self-contained", gray],
			["Targeted", gray],
			["UI", gray],
			["CLI", gray],
			["Server", gray],
			["Database", gray],
			["Fullstack", gray],
			["DevOps", gray],
			["Evals", gray],
			["Skill", gray],
			["Library", gray],
			["Unknown", gray],
		]);
	});

	it("keeps legacy multi-word aliases and strips 'until ...' suffixes", () => {
		expect(tagLook("Clean revert")).toEqual(tagLook("Reversible"));
		expect(tagLook("Revert + cleanup")).toEqual(tagLook("Cleanup"));
		expect(tagLook("UI only")).toEqual(tagLook("UI"));
		expect(tagLook("Full stack")).toEqual(tagLook("Fullstack"));
		expect(tagLook("Costs money")).toEqual(tagLook("Paid"));
		expect(tagLook("One-way until server ships")).toEqual(tagLook("One-way"));
	});
});

describe("PlanBody", () => {
	it("lets Goal, Details, and lead prose span the full card width", () => {
		const view = render(
			createElement(PlanBody, {
				text: [
					"Lead note.",
					"",
					"**Goal:** Replace the rolling score with earned trust levels.",
					"",
					"**Details:**",
					"- **Score by counted session** so each conversation contributes at most one session.",
					"- **Store overrides as bands** when reading or saving settings.",
					"",
					"**Tags:**",
					"- Clean revert: nothing stored",
				].join("\n"),
			}),
		);
		const goal = view.getByRole("region", { name: "Goal" });
		const details = view.getByRole("region", { name: "Details" });
		expect(goal.querySelector(".max-w-prose")).toBeNull();
		expect(details.querySelector(".max-w-prose")).toBeNull();
		expect(view.container.querySelector(".max-w-prose")).toBeNull();
	});
});
