import { afterEach, describe, expect, it } from "bun:test";
import type { ScoredDecision } from "@splates/server/trust";
import { OverturnedLine } from "./assumed-line";
import { cleanup, render } from "./testing-library";
import { type ConversationTrust, TrustContext } from "./trust-widget";

afterEach(cleanup);

describe("OverturnedLine", () => {
	it("ends with a shield-minus and what the overturn cost, once its decision is read", () => {
		const view = render(
			<TrustContext
				value={{ trust: trustWith(-6), agent: "Claude", project: null }}
			>
				<OverturnedLine number={1} words="Retry limit: 3 → 5" />
			</TrustContext>,
		);
		expect(view.getByRole("img", { name: "Trust −6" }).textContent).toBe("6");
	});

	it("carries no badge before trust is read", () => {
		const view = render(
			<OverturnedLine number={1} words="Retry limit: 3 → 5" />,
		);
		expect(view.queryByRole("img", { name: /Trust/ })).toBeNull();
	});
});

function trustWith(delta: number): ConversationTrust {
	const decision = {
		id: "overturn:assumed:c1:1",
		at: "2026-11-25T10:00:00Z",
		project: "/work/mono",
		agent: "claude",
		model: "Opus 4.6",
		kind: "defaults",
		source: "unasked",
		outcome: "overturned",
		subject: "Retry limit: 3",
		conversation: "c1",
		task: null,
		delta,
		after: 70,
	} satisfies ScoredDecision;
	return {
		entry: {
			project: "/work/mono",
			agent: "claude",
			model: "Opus 4.6",
			score: 70,
			dynamicScore: 70,
			mode: "dynamic",
			staticValue: null,
			resetAt: null,
			counts: { kept: 0, amended: 0, overturned: 1, total: 1 },
			kinds: [],
			lastAt: null,
		},
		decisions: [decision],
		net: delta,
	};
}
