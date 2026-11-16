import { describe, expect, it } from "bun:test";
import { blocksOf } from "./findings-blocks";

describe("blocksOf", () => {
	it("lifts each readout out of the markdown around it", () => {
		const blocks = blocksOf(
			[
				"Pass rate dipped.",
				"",
				"```stats",
				"Pass rate: 98.9% (-0.7 pts ❌)",
				"Flaky: 2",
				"```",
				"",
				"> ❌ **render.test.ts** broke",
				"",
				"```chart bar: Failures",
				"| Package | Count |",
				"| --- | --- |",
				"| vexml | 12 |",
				"| net | 5 |",
				"```",
				"",
				"```progress",
				"✅ Pass: 10",
				"❌ Fail: 1",
				"```",
				"",
				"| | Test | Detail |",
				"| --- | --- | --- |",
				"| ❌ | `a.test.ts` | fails |",
				"",
				"```steps",
				"✅ Ran suite · 41m",
				"```",
				"",
				"### Details",
				"",
				"More.",
			].join("\n"),
		);
		expect(blocks.map((block) => block.kind)).toEqual([
			"markdown",
			"stats",
			"callout",
			"chart",
			"progress",
			"status",
			"steps",
			"details",
		]);
		expect(blocks[1]).toEqual({
			kind: "stats",
			items: [
				{ label: "Pass rate", value: "98.9%", change: "-0.7 pts", tone: "bad" },
				{ label: "Flaky", value: "2", change: null, tone: "none" },
			],
		});
		expect(blocks[3]).toMatchObject({
			kind: "chart",
			chart: {
				type: "bar",
				labels: ["vexml", "net"],
				series: [{ values: [12, 5] }],
			},
		});
	});

	it("leaves a plain table, an unknown fence and a quote without an icon as markdown", () => {
		const text = [
			"| A | B |",
			"| --- | --- |",
			"| x | y |",
			"",
			"```mystery",
			"?",
			"```",
			"",
			"> just a quote",
		].join("\n");
		expect(blocksOf(text)).toEqual([{ kind: "markdown", text }]);
	});

	it("reads a gallery of absolute-path screenshots and drops other lines", () => {
		const blocks = blocksOf(
			[
				"```gallery",
				"![Before](/a/b.png)",
				"![After](/a/c.png)",
				"text",
				"```",
			].join("\n"),
		);
		expect(blocks).toEqual([
			{
				kind: "gallery",
				shots: [
					{ src: "/a/b.png", caption: "Before" },
					{ src: "/a/c.png", caption: "After" },
				],
			},
		]);
	});

	it("leaves a gallery with no screenshots as markdown", () => {
		expect(blocksOf("```gallery\nnothing\n```")[0]?.kind).toBe("markdown");
	});

	it("reads a d2 fence as a diagram", () => {
		expect(blocksOf("```d2\na -> b\n```")).toEqual([
			{ kind: "diagram", source: "a -> b" },
		]);
	});

	it("leaves an empty d2 fence as markdown", () => {
		expect(blocksOf("```d2\n\n```")[0]?.kind).toBe("markdown");
	});
});
