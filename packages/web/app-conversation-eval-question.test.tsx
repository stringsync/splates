import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { evalQuestionOf } from "./eval-question";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

const EVAL = [
	"```eval",
	"id: splates/add-before-investigating",
	"group: The splates skill",
	"title: starts a task with splates add before investigating a code change",
	"you: Fix the off-by-one bug in `paginate.ts`.",
	"tool: Bash splates add fix-paginate",
	"agent: Investigates inside the new worktree.",
	"check: a task exists before the first read of `paginate.ts`",
	"```",
];

const ASKED = [
	"1. Approve eval `splates/add-before-investigating`?",
	"   Agents read code before starting a task.",
	...EVAL.map((line) => `   ${line}`),
	"   - (a) Approve (chosen)",
	"   - (b) Edit",
	"   - (c) Drop",
].join("\n");

describe("evalQuestionOf", () => {
	it("takes the eval out of a question's body, keeping the words around it", () => {
		const found = evalQuestionOf(
			["Agents read code first.", "", ...EVAL, "", "More after."].join("\n"),
		);

		expect(found?.proposal.id).toBe("splates/add-before-investigating");
		expect(found?.rest).toBe("Agents read code first.\n\nMore after.");
	});

	it("finds none in a body without an eval, or with one that does not parse", () => {
		expect(evalQuestionOf("Just words.")).toBeNull();
		expect(evalQuestionOf("```eval\nnothing: here\n```")).toBeNull();
	});
});

describe("App's eval questions", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("asks a lone eval's approval inside the eval's own card, decided in a decision panel", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "propose an eval"),
					message("agent", `Here is one.\n\n${ASKED}`),
				],
			}),
		]);

		const asked = await waitFor(() =>
			view.getByRole("region", { name: "questions for you" }),
		);
		const cards = view.container.querySelectorAll(
			'[data-slot="eval-proposal"]',
		);
		expect(cards.length).toBe(1);
		expect((cards[0] as Element).contains(asked)).toBe(true);
		// One card: the eval's header, not a question card's.
		expect(asked.textContent).toContain("Eval · The splates skill");
		expect(asked.textContent).not.toContain("A question for you");
		expect(asked.textContent).toContain("starts a task with splates add");
		// Its note is the decision's own box, with no "Anything else" under it.
		expect(asked.textContent).not.toContain("Anything else");
		// The question's reason sits in the card, after the eval's checks.
		const why = within(asked).getByText(/Agents read code before/);
		const checks = within(asked).getByRole("region", { name: "Checks" });
		expect(
			checks.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		const decision = within(asked).getByRole("region", {
			name: "Eval decision",
		});
		expect(decision.textContent).toContain("Your decision");
		expect(decision.textContent).toContain(
			"Approve eval splates/add-before-investigating?",
		);
		const approve = within(decision).getByRole("button", { name: "Approve" });
		expect(approve.getAttribute("aria-pressed")).toBe("true");

		await act(async () =>
			fireEvent.click(within(decision).getByRole("button", { name: "Drop" })),
		);
		const drop = within(decision).getByRole("button", { name: "Drop" });
		expect(drop.getAttribute("aria-pressed")).toBe("true");
		expect(approve.getAttribute("aria-pressed")).toBe("false");

		// Clicking the picked decision again undoes it and turns Send back off.
		await act(async () => fireEvent.click(drop));
		expect(drop.getAttribute("aria-pressed")).toBe("false");
		expect(
			(
				within(asked).getByRole("button", {
					name: "Send",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("keeps the eval its own card above the questions when it is asked beside another", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "propose an eval"),
					message(
						"agent",
						`Here is one.\n\n${ASKED}\n2. Run it now?\n   It takes a minute.\n   - (a) Yes (chosen)\n   - (b) No`,
					),
				],
			}),
		]);

		const asked = await waitFor(() =>
			view.getByRole("region", { name: "questions for you" }),
		);
		const card = view.container.querySelector('[data-slot="eval-proposal"]');
		expect(card).not.toBeNull();
		expect(asked.contains(card)).toBe(false);
		expect((card as Element).contains(asked)).toBe(false);
		expect(
			(card as Element).compareDocumentPosition(asked) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(asked.textContent).toContain("Agents read code before");
		expect(asked.textContent).not.toContain("starts a task with splates add");
	});
});
