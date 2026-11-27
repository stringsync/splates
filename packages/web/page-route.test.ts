import { describe, expect, it } from "bun:test";
import { SparklesIcon } from "lucide-react";
import { PAGES } from "./page-route";

describe("PAGES", () => {
	it("uses the spark icon for Autopick in navigation", () => {
		const autoPick = PAGES.find((page) => page.value === "auto-pick");
		expect(autoPick?.Icon).toBe(SparklesIcon);
	});
});
