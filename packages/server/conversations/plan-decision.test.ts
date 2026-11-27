import { describe, expect, it } from "bun:test";
import {
	planApproved,
	planDecision,
	reviewHold,
	reviewPending,
} from "./plan-decision";
import { type Message, SERVER_TOLD } from "./state";

const PLAN = `## 📝 Plan: Limit upload size

**Goal:** Oversized uploads are accepted and can exhaust storage.
**After:** The upload handler rejects files larger than 100 bytes.
**Approach:** Check the byte count in the existing upload handler.`;

function said(
	role: Message["role"],
	text: string,
	more: Partial<Message> = {},
): Message {
	return {
		role,
		parts: [{ type: "text", text }],
		plan: null,
		at: null,
		until: null,
		...more,
	};
}

const approved = (...messages: Message[]) => planApproved({ messages });

describe("planApproved", () => {
	it("holds once the person approves the latest plan from its card", () => {
		expect(
			approved(
				said("agent", PLAN),
				said(
					"user",
					"Approve & start: Limit upload size\nPlan from 2026-11-26T12:00:00.000Z",
				),
			),
		).toBe(true);
		expect(
			approved(
				said("agent", PLAN),
				said("user", "Approve plan: Limit upload size"),
			),
		).toBe(true);
		expect(
			approved(said("agent", PLAN), said("user", "Approve: Limit upload size")),
		).toBe(true);
		expect(
			approved(
				said("agent", PLAN),
				said("user", "Approve & review: Limit upload size"),
			),
		).toBe(true);
	});

	it("does not read a message that only starts with the word Approve", () => {
		expect(
			approved(said("agent", PLAN), said("user", "Approve it once tests pass")),
		).toBe(false);
	});

	it("holds once the person approves a merge review after the plan", () => {
		expect(approved(said("agent", PLAN), said("user", "[SPLATES MERGE]"))).toBe(
			true,
		);
	});

	it("does not hold with no plan, an unanswered plan, or changes requested", () => {
		expect(approved(said("user", "Approve & start"))).toBe(false);
		expect(approved(said("agent", PLAN))).toBe(false);
		expect(
			approved(
				said("agent", PLAN),
				said("user", "Request changes: Limit upload size"),
			),
		).toBe(false);
	});

	it("does not count an approval another agent or the server said", () => {
		expect(
			approved(
				said("agent", PLAN),
				said("user", "Approve & start", { told: SERVER_TOLD }),
			),
		).toBe(false);
	});

	it("needs a fresh approval once a new plan follows the approved one", () => {
		expect(
			approved(
				said("agent", PLAN),
				said("user", "Approve & start"),
				said("agent", PLAN.replace("Limit upload size", "Limit upload count")),
			),
		).toBe(false);
	});
});

describe("planDecision", () => {
	it("reads each decision line the card sends, old and new", () => {
		expect(planDecision("Approve: Limit upload size")?.action).toBe("approve");
		expect(planDecision("Approve & start: Limit")?.action).toBe("approve");
		expect(planDecision("Approve plan")?.action).toBe("approve");
		expect(
			planDecision(
				"Approve & review: Limit upload size\nPlan from 2026-11-26T12:00:00.000Z",
			),
		).toEqual({
			action: "review",
			title: "Limit upload size",
			stamp: "2026-11-26T12:00:00.000Z",
		});
		expect(planDecision("Request changes: Limit\n\nSmaller")?.action).toBe(
			"revise",
		);
		expect(planDecision("Looks good")).toBeNull();
	});
});

describe("reviewPending", () => {
	const pending = (...messages: Message[]) => reviewPending({ messages });

	it("holds after Approve & review until the person approves a merge review", () => {
		expect(
			pending(
				said("agent", PLAN),
				said("user", "Approve & review: Limit upload size"),
			),
		).toBe(true);
		expect(
			pending(
				said("agent", PLAN),
				said("user", "Approve & review: Limit upload size"),
				said("user", "[SPLATES MERGE]"),
			),
		).toBe(false);
	});

	it("does not hold after a plain approval, or a review only another agent asked for", () => {
		expect(
			pending(said("agent", PLAN), said("user", "Approve: Limit upload size")),
		).toBe(false);
		expect(
			pending(
				said("agent", PLAN),
				said("user", "Approve & review: Limit upload size", {
					told: SERVER_TOLD,
				}),
			),
		).toBe(false);
	});

	it("follows the latest approval: a new plan approved plainly drops the review", () => {
		expect(
			pending(
				said("agent", PLAN),
				said("user", "Approve & review: Limit upload size"),
				said("agent", PLAN.replace("Limit upload size", "Limit upload count")),
				said("user", "Approve: Limit upload count"),
			),
		).toBe(false);
	});

	it("holds a One-way plan for review even on plain Approve until [SPLATES MERGE]", () => {
		const oneWay = taggedPlan("One-way: deleted rows cannot be recovered");
		expect(
			reviewHold({
				messages: [
					said("agent", oneWay),
					said("user", "Approve: Drop legacy records"),
				],
			}),
		).toBe("one-way");
		expect(
			pending(
				said("agent", oneWay),
				said("user", "Approve: Drop legacy records"),
			),
		).toBe(true);
		expect(
			pending(
				said("agent", oneWay),
				said("user", "Approve: Drop legacy records"),
				said("user", "[SPLATES MERGE]"),
			),
		).toBe(false);
	});

	it("holds a One-way plan even without an Approve message, and handles 'One-way until'", () => {
		const oneWay = taggedPlan(
			"One-way until server ships: drops legacy column",
		);
		expect(pending(said("agent", oneWay))).toBe(true);
		expect(
			pending(said("agent", oneWay), said("user", "[SPLATES MERGE]")),
		).toBe(false);
	});

	it("does not hold Clean revert or Revert + cleanup plans on plain Approve", () => {
		expect(
			pending(
				said("agent", taggedPlan("Clean revert: reverting restores it")),
				said("user", "Approve: Drop legacy records"),
			),
		).toBe(false);
		expect(
			pending(
				said(
					"agent",
					taggedPlan("Revert + cleanup: drop the new table by hand"),
				),
				said("user", "Approve: Drop legacy records"),
			),
		).toBe(false);
	});

	it("drops the One-way hold when a newer plan is Clean revert", () => {
		expect(
			pending(
				said("agent", taggedPlan("One-way: deletes rows")),
				said("user", "Approve: Drop legacy records"),
				said(
					"agent",
					taggedPlan("Clean revert: hides rows instead", "Hide legacy records"),
				),
				said("user", "Approve: Hide legacy records"),
			),
		).toBe(false);
	});
});

function taggedPlan(undo: string, title = "Drop legacy records"): string {
	return `## 📝 Plan: ${title}

**Goal:** Remove old upload rows.

**Details:**
- Delete rows older than 90 days.

**Tags:**
- ${undo}
- Small: one migration.
- Database: deletes stored rows.`;
}
