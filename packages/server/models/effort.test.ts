import { describe, expect, it } from "bun:test";
import type { Setting } from "../conversations";
import { effortSettings, pickEffort, pickSettings } from "./effort";

const EFFORT: Setting = {
	id: "effort",
	name: "Effort",
	type: "select",
	category: "thought_level",
	current: "default",
	options: ["default", "low", "high"].map((value) => ({
		value,
		name: value[0]?.toUpperCase() + value.slice(1),
		description: null,
	})),
};

const MODE: Setting = {
	id: "mode",
	name: "Mode",
	type: "select",
	category: "mode",
	current: "auto",
	options: ["default", "auto"].map((value) => ({
		value,
		name: value,
		description: null,
	})),
};

describe("effort", () => {
	it("opens a pick on the person's saved mode as well as its level", () => {
		expect(pickSettings("high", [MODE, EFFORT])).toEqual({
			mode: "auto",
			effort: "high",
		});
		expect(pickSettings(undefined, [MODE])).toEqual({ mode: "auto" });
		expect(pickSettings("high", [EFFORT])).toEqual({ effort: "high" });
	});

	it("puts the level in the thinking setting, or nowhere without one", () => {
		expect(effortSettings("high", [EFFORT])).toEqual({ effort: "high" });
		expect(effortSettings(undefined, [EFFORT])).toEqual({});
		expect(effortSettings("high", [])).toEqual({});
	});

	it("takes a level the agent offers, by its value or name in any case", () => {
		expect(pickEffort([EFFORT], "claude", "high")).toBe("high");
		expect(pickEffort([EFFORT], "claude", "LOW")).toBe("low");
	});

	it("takes any level for an agent that has offered nothing yet", () => {
		expect(pickEffort(undefined, "claude", "max")).toBe("max");
	});

	it("refuses a level the agent does not offer, or one with no thinking setting", () => {
		expect(() => pickEffort([EFFORT], "claude", "max")).toThrow(
			"use one of default, low, high",
		);
		expect(() => pickEffort([], "codex", "high")).toThrow(
			"codex offers no thinking level",
		);
	});
});
