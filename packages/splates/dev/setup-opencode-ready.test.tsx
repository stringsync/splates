import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConversationFeed } from "./conversation-feed";
import { OpenCodeReadyControls } from "./setup-opencode-ready";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

describe("OpenCode completion", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
		testing.opencodeReadiness.selection = {
			model: "opencode-go/Main",
			auxiliary: "opencode-go/Small",
		};
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});
	it("revisits a saved recipe without claiming readiness, then requires Console confirmation", async () => {
		const view = render(
			<OpenCodeReadyControls
				feed={new ConversationFeed()}
				onOpen={() => {}}
				onRepair={() => {}}
			/>,
		);
		await waitFor(() =>
			expect(view.getByText(/Saved recipe found/)).toBeTruthy(),
		);
		expect(testing.posts).toEqual([]);
		expect(
			view.queryByRole("button", { name: "New OpenCode conversation" }),
		).toBeNull();
		testing.reply = {
			...testing.opencodeReadiness,
			ready: true,
			checkedAt: "fixture",
		};
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Check configuration" }),
			),
		);
		await waitFor(() =>
			expect(
				view.getByText("Configuration ready for this directory."),
			).toBeTruthy(),
		);
		expect(view.getByText(/Live inference: not tested/)).toBeTruthy();
		expect(
			(
				view.getByRole("button", {
					name: "New OpenCode conversation",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(
			view.getByRole("switch", {
				name: "I confirmed Use balance is off in Console",
			}),
		);
		expect(
			(
				view.getByRole("button", {
					name: "New OpenCode conversation",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});
	it("shows a check failure, allows repair and retries without opening a conversation", async () => {
		let repairs = 0;
		const view = render(
			<OpenCodeReadyControls
				feed={null}
				onOpen={() => {}}
				onRepair={() => {
					repairs++;
				}}
			/>,
		);
		await waitFor(() =>
			expect(view.getByText(/Saved recipe found/)).toBeTruthy(),
		);
		testing.reply = {
			...testing.opencodeReadiness,
			problem: "Saved model unavailable. Choose again.",
		};
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Check configuration" }),
			),
		);
		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain("unavailable"),
		);
		fireEvent.click(
			view.getByRole("button", { name: "Revisit / repair setup" }),
		);
		expect(repairs).toBe(1);
		testing.reply = { ...testing.opencodeReadiness, ready: true };
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Check configuration" }),
			),
		);
		await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
		expect(testing.posted("/api/setup/opencode/conversation")).toEqual([]);
	});
	it("disables through the dedicated route and cancels when leaving", async () => {
		const view = render(
			<OpenCodeReadyControls
				feed={null}
				onOpen={() => {}}
				onRepair={() => {}}
			/>,
		);
		await waitFor(() =>
			expect(view.getByText(/Saved recipe found/)).toBeTruthy(),
		);
		testing.opencodeReadiness.selection = null;
		testing.reply = {};
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Disable OpenCode experiment" }),
			),
		);
		await waitFor(() =>
			expect(view.getByText(/No verified setup recipe/)).toBeTruthy(),
		);
		expect(testing.posted("/api/setup/opencode/disable")).toHaveLength(1);
		view.unmount();
		expect(testing.posted("/api/setup/opencode/cancel")).toHaveLength(1);
	});
});
