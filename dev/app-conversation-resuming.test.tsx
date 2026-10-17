import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's sending to a stopped conversation", () => {
	let testing: Testing;
	const said = [message("user", "fix the login"), message("agent", "Done.")];
	let view: Awaited<ReturnType<Testing["openConversations"]>>;
	let thread: HTMLElement;
	let box: HTMLElement;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations([
			conversation({ title: "Login", status: "stopped", messages: said }),
		]);
		thread = view.getByRole("region", { name: "Login" });
		box = view.getByRole("textbox", { name: "Message input" });
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows each message to a stopped conversation at once while its agent resumes, those after the first as queued until the server has them", async () => {
		await typeIn(box, "and the logout");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await typeIn(box, "and the signup");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(within(thread).getAllByText("and the logout")).toHaveLength(1),
		);
		const queued = within(thread).getByRole("region", {
			name: "queued messages",
		});
		expect(within(queued).getByText("and the signup")).toBeTruthy();
		// The server has nothing of it to take back yet.
		const discard = within(queued).getByRole("button", {
			name: "Discard and the signup",
		}) as HTMLButtonElement;
		expect(discard.disabled).toBe(true);

		await testing.say(
			conversation({
				title: "Login",
				status: "running",
				messages: [
					...said,
					{
						...message("user", "and the logout"),
						id: testing.sentId("c1", "and the logout"),
					},
					{
						...message("user", "and the signup"),
						queued: true,
						id: testing.sentId("c1", "and the signup"),
					},
				],
			}),
		);

		await waitFor(() => expect(discard.disabled).toBe(false));
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
		expect(within(thread).getAllByText("and the signup")).toHaveLength(1);
	});

	it("keeps showing a message on its way while the server records one told by another conversation, then shows it once", async () => {
		await typeIn(box, "and the logout");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() =>
			expect(within(thread).getAllByText("and the logout")).toHaveLength(1),
		);
		const told = { ...message("user", "carry on"), told: "c2" };

		await testing.say(
			conversation({
				title: "Login",
				status: "running",
				messages: [...said, told],
			}),
		);

		await waitFor(() =>
			expect(within(thread).getAllByText("carry on")).toHaveLength(1),
		);
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);

		await testing.say(
			conversation({
				title: "Login",
				status: "running",
				messages: [
					...said,
					told,
					{
						...message("user", "and the logout"),
						queued: true,
						id: testing.sentId("c1", "and the logout"),
					},
				],
			}),
		);

		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
	});
});
