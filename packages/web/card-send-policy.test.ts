import { describe, expect, it } from "bun:test";
import {
	type CardSendInput,
	cardSendPolicy,
	toggleDecision,
} from "./card-send-policy";

const base = (overrides: Partial<CardSendInput> = {}): CardSendInput => ({
	live: true,
	pending: false,
	decidePlan: false,
	decision: null,
	unansweredPlan: false,
	empty: true,
	taking: false,
	answering: false,
	...overrides,
});

describe("toggleDecision", () => {
	it("picks an unselected choice, switches to another, and undoes the picked one", () => {
		expect(toggleDecision(null, "approve")).toBe("approve");
		expect(toggleDecision("approve", "revise")).toBe("revise");
		expect(toggleDecision("approve", "approve")).toBeNull();
	});
});

describe("cardSendPolicy", () => {
	it("disables Send on an empty question card unless dictation is taking", () => {
		expect(cardSendPolicy(base())).toMatchObject({
			canSubmit: false,
			canSend: false,
			disabled: true,
			label: "Send",
		});
		expect(cardSendPolicy(base({ taking: true }))).toMatchObject({
			canSubmit: false,
			canSend: true,
			disabled: false,
		});
		expect(cardSendPolicy(base({ empty: false }))).toMatchObject({
			canSubmit: true,
			canSend: true,
			disabled: false,
		});
	});

	it("labels ACP form cards Answer and disables while pending or not live", () => {
		expect(
			cardSendPolicy(base({ empty: false, answering: true })),
		).toMatchObject({
			disabled: false,
			label: "Answer",
		});
		expect(cardSendPolicy(base({ empty: false, pending: true }))).toMatchObject(
			{
				canSubmit: false,
				canSend: false,
				disabled: true,
				pending: true,
			},
		);
		expect(cardSendPolicy(base({ empty: false, live: false }))).toMatchObject({
			canSubmit: false,
			canSend: false,
			disabled: true,
		});
	});

	it("requires a valid plan decision and never lets dictation bypass an undecided plan", () => {
		expect(
			cardSendPolicy(base({ decidePlan: true, taking: true })),
		).toMatchObject({
			canApprove: true,
			undecided: true,
			canSubmit: false,
			canSend: false,
			disabled: true,
		});
		expect(
			cardSendPolicy(base({ decidePlan: true, decision: "approve" })),
		).toMatchObject({
			canApprove: true,
			undecided: false,
			canSubmit: true,
			canSend: true,
			disabled: false,
		});
		expect(
			cardSendPolicy(
				base({ decidePlan: true, decision: "approve", unansweredPlan: true }),
			),
		).toMatchObject({
			canApprove: false,
			undecided: true,
			canSubmit: false,
			canSend: false,
			disabled: true,
		});
		expect(
			cardSendPolicy(
				base({ decidePlan: true, decision: "review", unansweredPlan: true }),
			),
		).toMatchObject({
			canApprove: false,
			undecided: true,
			disabled: true,
		});
		expect(
			cardSendPolicy(
				base({ decidePlan: true, decision: "revise", unansweredPlan: true }),
			),
		).toMatchObject({
			canApprove: false,
			undecided: false,
			canSubmit: true,
			canSend: true,
			disabled: false,
		});
	});
});
