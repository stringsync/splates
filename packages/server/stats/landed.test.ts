import { describe, expect, it } from "bun:test";
import { landed } from "./landed";
import type { Outcome } from "./outcomes";

describe("landed", () => {
	it("holds a task's last merge against its project's week up to it, however late it is asked", () => {
		const found = landed(
			[
				ended({ task: "alpha", endedAt: "2026-10-10T10:00:00.000Z" }),
				...Array.from({ length: 10 }, () =>
					ended({ endedAt: "2026-10-12T10:00:00.000Z" }),
				),
				ended({ task: "alpha", endedAt: "2026-10-14T10:00:00.000Z" }),
				// After it, so not in what it is held against.
				ended({ endedAt: "2026-10-20T10:00:00.000Z" }),
				ended({ project: "/other", task: "alpha" }),
				ended({ task: "alpha", ended: "removed" }),
			],
			"/repo",
			"alpha",
		);

		expect(found?.outcome.endedAt).toBe("2026-10-14T10:00:00.000Z");
		expect(found?.baseline).toMatchObject({ project: "/repo", tasks: 12 });
	});

	it("finds nothing for a task that never merged in the project", () => {
		expect(landed([ended({ project: "/other" })], "/repo", "beta")).toBeNull();
	});
});

/** A merged task of `/repo`'s; a test overrides what it is about. */
function ended(changes: Partial<Outcome>): Outcome {
	return {
		project: "/repo",
		task: "beta",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-10T09:00:00.000Z",
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: null,
		agent: null,
		model: null,
		...changes,
	};
}
