import { expect, test } from "bun:test";
import { view } from "core/ship";
import { placeholderShips } from "./placeholder-ships";

test("the placeholder ships plan, the dependent after the quick one", () => {
	const upstream = () => ({ version: "0.0.1" });
	const plans = placeholderShips().map((each) => view(each, { upstream }));
	expect(
		plans.map(({ name, dependencies }) => ({ name, dependencies })),
	).toEqual([
		{ name: "placeholder-quick", dependencies: [] },
		{ name: "placeholder-slow", dependencies: [] },
		{ name: "placeholder-failing", dependencies: [] },
		{ name: "placeholder-prompts", dependencies: [] },
		{ name: "placeholder-dependent", dependencies: ["placeholder-quick"] },
		{ name: "placeholder-noisy", dependencies: [] },
	]);
});
