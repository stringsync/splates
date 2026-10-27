import { describe, expect, it } from "bun:test";
import type { Needing } from "@stringsync/splates-server/plans/browser";
import { statusOf } from "./phone-inbox-row";

describe("statusOf", () => {
	it("says a queued merge is waiting, and its place in line once the lock has told it", () => {
		const waiting = (mergePlace?: number) => {
			const row: Needing = {
				conversation: null,
				task: null,
				need: {
					kind: "working",
					subject: null,
					merge: "queued",
					...(mergePlace === undefined ? {} : { mergePlace }),
				},
			};
			return statusOf(row, "alpha", "main").text;
		};

		expect([waiting(), waiting(1), waiting(3)]).toEqual([
			"Waiting to merge",
			"Waiting to merge · next",
			"Waiting to merge · 3rd in line",
		]);
	});

	it("says an agent whose eval run goes is running evals", () => {
		const row: Needing = {
			conversation: null,
			task: null,
			need: { kind: "working", subject: "Tighten the wording", evals: true },
		};

		expect(statusOf(row, "alpha", "main")).toEqual({
			text: "Running evals",
			urgent: false,
		});
	});
});
