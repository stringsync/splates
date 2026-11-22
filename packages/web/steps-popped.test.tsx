import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Steps } from "@splates/server/plans/browser";
import { ReplyContext } from "./card-reply";
import { Popped } from "./steps-popped";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

describe("the Steps pop-out", () => {
	beforeEach(() => localStorage.clear());
	afterEach(cleanup);

	it("shows each question under a line naming its step, then the agent's answers", () => {
		const view = render(
			popped({
				exchanges: [
					{
						id: "u1",
						step: 2,
						words: "No Roll button.",
						answers: ["It's in the ⋯ menu."],
						carded: false,
						waiting: false,
					},
				],
			}),
		);
		const chat = within(view.container).getByRole("region", {
			name: "Asked on step 2",
		});

		expect(chat.textContent).toContain("No Roll button.");
		expect(chat.textContent).toContain("It's in the ⋯ menu.");
		expect(within(chat).queryByRole("status")).toBeNull();
	});

	it("shows the agent at work on a question with no answer yet", () => {
		const view = render(
			popped({
				exchanges: [
					{
						id: "u1",
						step: 2,
						words: "Hm?",
						answers: [],
						carded: false,
						waiting: true,
					},
				],
			}),
		);

		expect(
			within(view.container).getByRole("status", {
				name: "The agent is answering",
			}),
		).toBeTruthy();
	});

	it("names the step the person is on in its box, and offers no box where nothing can be sent", () => {
		const view = render(
			<ReplyContext
				value={{
					send: async () => {},
					drafts: { read: () => "", write: () => {} },
				}}
			>
				{popped()}
			</ReplyContext>,
		);
		expect(view.container.textContent).toContain("Ask about step 2…");
		cleanup();

		const alone = render(popped());

		expect(
			within(alone.container).queryByRole("button", { name: "Send" }),
		).toBeNull();
	});

	it("says which steps the agent updated, and Undo turns back to the version before", async () => {
		const toggled: string[] = [];
		const view = render(
			popped({
				update: { back: false, steps: [1], toggle: () => toggled.push("undo") },
			}),
		);

		expect(view.container.textContent).toContain("The agent updated step 2");
		await act(async () =>
			fireEvent.click(
				within(view.container).getByRole("button", { name: "Undo" }),
			),
		);
		expect(toggled).toEqual(["undo"]);
	});
});

const STEPS: Steps = {
	title: "Rotate the secret",
	intro: "",
	steps: ["Open the dashboard.", "Copy the secret.", "Store it."],
	outro: "",
};

function popped(props: Partial<Parameters<typeof Popped>[0]> = {}) {
	return (
		<Popped
			steps={STEPS}
			done={1}
			place={() => {}}
			move={() => {}}
			changed={new Map()}
			exchanges={[]}
			update={null}
			window={window}
			{...props}
		/>
	);
}
