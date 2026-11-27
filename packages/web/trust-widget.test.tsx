import { afterEach, describe, expect, it } from "bun:test";
import type { ScoredDecision, TrustEntry } from "@splates/server/trust";
import { cleanup, fireEvent, render, within } from "./testing-library";
import {
	type ConversationTrust,
	decisionsFor,
	overturnDecisions,
	redoDecisions,
	TrustBadge,
	TrustCard,
	TrustChange,
	TrustContext,
} from "./trust-widget";

afterEach(cleanup);

describe("TrustCard", () => {
	it("shows the score and this conversation's net change at rest", () => {
		const view = card(false);
		const row = view.getByRole("button");
		expect(row.textContent).toBe("Trust+184");
	});

	it("opens, on a phone, the breakdown by kind and this conversation's picks, oldest first", () => {
		const view = card(true);
		fireEvent.click(view.getByRole("button", { name: /Trust/ }));
		const kinds = within(view.getByRole("list", { name: "trust by kind" }));
		expect(
			kinds.getAllByRole("listitem").map((each) => each.textContent),
		).toEqual([
			"Defaults0",
			"API / design0",
			"Scope / split0",
			"Visual / UI68",
			"Approval0",
		]);
		const here = within(
			view.getByRole("region", { name: "this conversation" }),
		);
		expect(
			here.getAllByRole("listitem").map((each) => each.textContent),
		).toEqual([
			"Keep old endpoint 1 release · API+2",
			"Compact card layout → Roomy · Visual−1",
		]);
		expect(view.getByText("Trust →").getAttribute("href")).toBe("#trust");
		expect(view.getByText("mono · Dynamic · Ask & go")).toBeDefined();
	});

	it("shows nothing until trust is read", () => {
		const view = render(<TrustCard phone={false} />);
		expect(view.container.textContent).toBe("");
	});
});

describe("TrustBadge and TrustChange", () => {
	it("carries the net change and opens the score before and after with each pick's change", () => {
		const decisions = trust.decisions;
		let open = false;
		const view = render(
			<TrustBadge
				decisions={decisions}
				open={open}
				onToggle={() => {
					open = true;
				}}
			/>,
		);
		const badge = view.getByRole("button", { name: "Trust +1" });
		fireEvent.click(badge);
		expect(open).toBe(true);
		cleanup();
		const change = render(<TrustChange decisions={decisions} agent="Claude" />);
		const region = change.getByRole("region", { name: "trust change" });
		expect(region.textContent).toContain("82 → 83");
		expect(region.textContent).toContain(
			"2. Compact card layout → Roomy · Visual / UI (changed)−1",
		);
	});

	it("shows a shield-plus or shield-minus and the unsigned size, or a plain shield and 0 at net zero", () => {
		const gained = render(<TrustBadge decisions={[decision({ delta: 3 })]} />);
		const up = gained.getByRole("img", { name: "Trust +3" });
		expect(up.textContent).toBe("3");
		expect(up.querySelector(".lucide-shield-plus")).not.toBeNull();
		cleanup();
		const lost = render(<TrustBadge decisions={[decision({ delta: -6 })]} />);
		const down = lost.getByRole("img", { name: "Trust −6" });
		expect(down.textContent).toBe("6");
		expect(down.querySelector(".lucide-shield-minus")).not.toBeNull();
		cleanup();
		const even = render(
			<TrustBadge
				decisions={[decision({ delta: 2 }), decision({ delta: -2 })]}
			/>,
		);
		const flat = even.getByRole("img", { name: "Trust ±0" });
		expect(flat.textContent).toBe("0");
		expect(flat.querySelector(".lucide-shield")).not.toBeNull();
	});

	it("finds an overturn's decision by its number, else by the pick it names", () => {
		const overturn = decision({
			id: "overturn:assumed:c1:2",
			source: "unasked",
			outcome: "overturned",
			subject: "Retry limit: 3",
			delta: -6,
		});
		const thread = {
			trust: { ...trust, decisions: [...trust.decisions, overturn] },
			agent: "Claude",
			project: null,
		};
		expect(overturnDecisions(thread, 2, "Retry limit: 3 → 5")).toEqual([
			overturn,
		]);
		expect(overturnDecisions(thread, 1, "Retry limit: 3 → 5")).toEqual([
			overturn,
		]);
		expect(overturnDecisions(thread, 1, "Backoff → linear")).toEqual([]);
	});

	it("finds a task's redo decision", () => {
		const redo = decision({
			id: "redo:/work/mono:fix-drag:2026-11-25T11:00:00Z",
			source: "redo",
			outcome: "overturned",
			task: "fix-drag",
			delta: -3,
		});
		const thread = {
			trust: { ...trust, decisions: [...trust.decisions, redo] },
			agent: "Claude",
			project: null,
		};
		expect(redoDecisions(thread, "fix-drag")).toEqual([redo]);
		expect(redoDecisions(thread, "other")).toEqual([]);
	});

	it("finds a message's decisions by its index and its questions", () => {
		const thread = { trust, agent: "Claude", project: null };
		expect(
			decisionsFor(thread, "3", ["Should the old endpoint stay?"]),
		).toHaveLength(1);
		expect(decisionsFor(thread, "3", ["Which layout?"])).toHaveLength(0);
		expect(
			decisionsFor(thread, "4", ["Should the old endpoint stay?"]),
		).toHaveLength(0);
	});
});

const entry: TrustEntry = {
	project: "/work/mono",
	agent: "claude",
	model: "Opus 4.6",
	score: 84,
	dynamicScore: 84,
	mode: "dynamic",
	staticValue: null,
	resetAt: null,
	counts: { kept: 9, amended: 0, overturned: 1, total: 10 },
	kinds: [
		{
			kind: "visual",
			score: 68,
			counts: { kept: 1, amended: 0, overturned: 1, total: 2 },
		},
	],
	lastAt: null,
};

function decision(overrides: Partial<ScoredDecision>): ScoredDecision {
	return {
		id: "conv:c1:3:0:0",
		at: "2026-11-25T10:00:00Z",
		project: "/work/mono",
		agent: "claude",
		model: "Opus 4.6",
		kind: "design",
		source: "question",
		outcome: "kept",
		subject: "Should the old endpoint stay?",
		picked: "Keep old endpoint 1 release",
		conversation: "c1",
		task: null,
		delta: 2,
		after: 84,
		...overrides,
	};
}

const trust: ConversationTrust = {
	entry,
	decisions: [
		decision({}),
		decision({
			id: "conv:c1:5:0:0",
			kind: "visual",
			outcome: "overturned",
			subject: "Which layout?",
			picked: "Compact card layout",
			instead: "Roomy",
			delta: -1,
			after: 83,
		}),
	],
	net: 1,
};

function card(phone: boolean) {
	return render(
		<TrustContext value={{ trust, agent: "Claude", project: "/work/mono" }}>
			<TrustCard phone={phone} />
		</TrustContext>,
	);
}
