import { describe, expect, it } from "bun:test";
import { shipFailureReference, shipSlowReference } from "./prompts";

describe("ship references", () => {
	it("retries through the local server, naming the Origin it asks of a write", () => {
		const text = shipFailureReference({
			id: "c1",
			project: "mdom",
			stage: "publish",
		});
		expect(text).toContain(
			'curl -X POST -H "Origin: $SPLATES_DEV" "$SPLATES_DEV/api/ship/steps/retry"',
		);
		expect(text).toContain(
			'curl "$SPLATES_DEV/api/ship/history/c1/log?project=mdom&stage=publish"',
		);
	});

	it("asks an agent to look without touching the running ship", () => {
		const text = shipSlowReference({
			id: "c1",
			project: "mdom",
			stage: "gate",
			spent: 22 * 60_000,
			expected: 10 * 60_000,
			log: "a\nb",
		});
		expect(text).toContain(
			"`gate` stage of `mdom` is slow: 22m so far against about 10m",
		);
		expect(text).toContain("project=mdom&stage=gate");
		expect(text).toContain("Do not stop it, retry it");
		expect(text).toContain("a\nb");
	});
});
