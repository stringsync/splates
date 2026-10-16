import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	resize,
	Testing,
	textIn,
	tool,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's sending messages", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("offers the tree's files for an @ in the composer, over the composer, each its name before its folder, and writes the one picked", async () => {
		testing.tree = ["README.md", "src/", "src/components/", "src/index.ts"];
		const view = await testing.openConversations([]);
		const box = view.getByRole("textbox", {
			name: "Message input",
		});

		await typeIn(box, "see @comp");
		const list = await waitFor(() => view.getByRole("listbox"));
		// The name first, so a long path loses its folder rather than its name.
		expect(
			within(list)
				.getAllByRole("option")
				.map((option) =>
					[...option.querySelectorAll("span")].map((span) => span.textContent),
				),
		).toEqual([["components/", "src/"]]);
		// Out of the flow, held to a box of the composer's own, so it floats
		// over the thread rather than pushing the composer down or anchoring
		// to the thread's scroller, off the top of the page.
		expect(list.classList.contains("absolute")).toBe(true);
		expect(list.parentElement?.classList.contains("relative")).toBe(true);
		expect(list.parentElement?.contains(box)).toBe(true);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(textIn(box)).toBe("see @src/components/ ");
		expect(testing.posted("/api/conversations")).toEqual([]);
	});

	it("shows no list over the composer for an @ no file matches, as right after a file's chip, and sends on Enter", async () => {
		testing.tree = ["README.md", "src/", "src/index.ts"];
		const view = await testing.openConversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", {
			name: "Message input",
		});

		await typeIn(box, "see @src/index.ts");

		expect(view.queryByLabelText("mentions")).toBeNull();
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations")).toHaveLength(1),
		);
	});

	it("shows the first message in the new conversation's thread and row while its agent starts, then as the server has it", async () => {
		const view = await testing.openConversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fix the login");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const thread = await waitFor(() =>
			view.getByRole("region", { name: "fix the login" }),
		);
		// The message, and its title in the page's bar.
		expect(within(thread).getByText("fix the login")).toBeTruthy();
		expect(view.getByRole("heading", { name: "fix the login" })).toBeTruthy();
		expect(
			within(view.getByRole("list", { name: "conversation list" })).getByText(
				"fix the login",
			),
		).toBeTruthy();

		await testing.say(
			conversation({
				id: "c9",
				status: "running",
				messages: [message("user", "fix the login")],
			}),
		);

		await waitFor(() =>
			expect(
				within(thread).getByRole("button", { name: "Stop generating" }),
			).toBeTruthy(),
		);
		expect(within(thread).getByText("fix the login")).toBeTruthy();
		expect(view.getByRole("heading", { name: "fix the login" })).toBeTruthy();
	});

	it("shows the images sent with the first message in the new conversation's thread while its agent starts, then as the server keeps them", async () => {
		const view = await testing.openConversations([], null);
		testing.reply = conversation({ id: "c9", status: "starting" });
		const box = view.getByRole("textbox", { name: "Message input" });
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await act(async () =>
			fireEvent.paste(box, { clipboardData: { files: [shot] } }),
		);

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const thread = await waitFor(() =>
			view.getByRole("region", { name: "[Image 1]" }),
		);
		await waitFor(() =>
			expect(
				within(thread)
					.getByRole("button", { name: "Image 1" })
					.getAttribute("title"),
			).toBe("shot.png"),
		);

		await testing.say(
			conversation({
				id: "c9",
				status: "running",
				messages: [
					{
						...message("user", ""),
						parts: [{ type: "image", name: "ab12.png", mimeType: "image/png" }],
					},
				],
			}),
		);

		await waitFor(() =>
			expect(
				within(thread)
					.getByRole("button", { name: "Image 1" })
					.getAttribute("title"),
			).toBe("ab12.png"),
		);
	});

	it("shows a message to a stopped conversation in its thread while its agent resumes, then as the server has it", async () => {
		const said = [message("user", "fix the login"), message("agent", "Done.")];
		const view = await testing.openConversations([
			conversation({ title: "Login", status: "stopped", messages: said }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "and the logout");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(within(thread).getAllByText("and the logout")).toHaveLength(1),
		);
		expect(thread.textContent).toContain("Done.");

		await testing.say(
			conversation({
				title: "Login",
				status: "running",
				messages: [...said, message("user", "and the logout")],
			}),
		);

		await waitFor(() =>
			expect(
				within(thread).getByRole("button", { name: "Stop generating" }),
			).toBeTruthy(),
		);
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
	});

	it("shows each message to a stopped conversation at once while its agent resumes, those after the first as queued until the server has them", async () => {
		const said = [message("user", "fix the login"), message("agent", "Done.")];
		const view = await testing.openConversations([
			conversation({ title: "Login", status: "stopped", messages: said }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", { name: "Message input" });

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
					message("user", "and the logout"),
					{ ...message("user", "and the signup"), queued: true },
				],
			}),
		);

		await waitFor(() => expect(discard.disabled).toBe(false));
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
		expect(within(thread).getAllByText("and the signup")).toHaveLength(1);
	});

	it("shows a message to an idle conversation at once, with its reply's place, rather than once the server says it back", async () => {
		const said = [message("user", "fix the login"), message("agent", "Done.")];
		const view = await testing.openConversations([
			conversation({ title: "Login", status: "idle", messages: said }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "and the logout");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		// With its reply's place in the same step, so the thread anchors the
		// message once, not again when the server's copy comes.
		await waitFor(() =>
			expect(within(thread).getAllByText("and the logout")).toHaveLength(1),
		);
		expect(
			within(thread).getByRole("button", { name: "Stop generating" }),
		).toBeTruthy();

		await testing.say(
			conversation({
				title: "Login",
				status: "running",
				messages: [...said, message("user", "and the logout")],
			}),
		);

		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
		expect(
			within(thread).getByRole("button", { name: "Stop generating" }),
		).toBeTruthy();
	});

	it("marks a message the agent took into its running turn as steered", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Login",
				status: "running",
				messages: [
					message("user", "fix the login"),
					message("agent", "On it."),
					{ ...message("user", "and the logout"), steered: true },
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Login" });

		const marks = await within(thread).findAllByText(
			"Steered into the running turn",
		);
		expect(marks).toHaveLength(1);
		expect(marks[0]?.closest('[data-role="user"]')?.textContent).toContain(
			"and the logout",
		);
	});

	it("shows each system, file and directory a message names as a chip, the agent's too", async () => {
		testing.systems = [
			{ name: "playback", aliases: ["player"], globs: ["src/audio/**"] },
		];
		testing.tree = ["src/", "src/index.ts"];
		const view = await testing.openConversations([
			conversation({
				title: "Login",
				messages: [
					message("user", "fix #player in @src/index.ts, not @src/gone.ts"),
					message("agent", "The stutter is in #playback, under @src/."),
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Login" });

		const file = await waitFor(() =>
			within(thread).getByTitle("/repo/src/index.ts"),
		);
		expect(file.textContent).toBe("index.ts");
		expect(file.getAttribute("href")).toBe("zed://file/repo/src/index.ts");
		const [system, replied] = within(thread).getAllByRole("button", {
			name: "playback",
		});
		expect(replied).toBeTruthy();
		await act(async () => fireEvent.click(system as HTMLElement));
		expect(
			(await view.findByRole("list", { name: "playback globs" })).textContent,
		).toBe("src/audio/**");
		expect(within(thread).getByText(/not @src\/gone\.ts/)).toBeTruthy();
		const folder = within(thread).getByTitle("/repo/src/");
		expect(folder.textContent).toBe("src/");
	});

	it("keeps a message the server refuses in the thread, saying it was not sent, to send again", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Login", status: "stopped" }),
		]);
		const thread = view.getByRole("region", { name: "Login" });
		const box = view.getByRole("textbox", {
			name: "Message input",
		});
		testing.refuseWrites = { reason: "usage", message: "cannot resume" };
		await typeIn(box, "and the logout");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const unsent = await waitFor(() =>
			within(thread).getByText("Couldn't send"),
		);
		// Why, on hover, rather than a banner over the composer.
		expect(unsent.title).toBe("cannot resume");
		expect(within(thread).queryByRole("alert")).toBeNull();
		expect(textIn(box)).toBe("");
		const said = thread.querySelectorAll('[data-role="user"]');
		expect([...said].map((each) => each.textContent)).toEqual([
			expect.stringContaining("and the logout"),
		]);

		testing.refuseWrites = null;
		await act(async () =>
			fireEvent.click(within(thread).getByRole("button", { name: "Retry" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(2);
		expect(within(thread).queryByText("Couldn't send")).toBeNull();
		expect(thread.querySelectorAll('[data-role="user"]')).toHaveLength(1);
	});

	it("shows a message sent mid-turn among the queued at once, before the server has it", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Login",
				status: "running",
				messages: [message("user", "go")],
			}),
		]);
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "and the logout");

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		const queued = view.getByRole("region", { name: "queued messages" });
		expect(
			within(queued)
				.getAllByRole("listitem")
				.map((each) => each.textContent),
		).toEqual([expect.stringContaining("and the logout")]);
	});

	it("names the layout each message is sent from, for the Stats page", async () => {
		const send = async (text: string) => {
			const view = await testing.openConversations([conversation()]);
			const box = await waitFor(() =>
				view.getByRole("textbox", { name: "Message input" }),
			);
			await typeIn(box, text);
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
			cleanup();
		};

		await send("at a desk");
		resize(390, 844);
		await send("on a phone").finally(() => resize(1024, 768));

		expect(testing.posts).toEqual([
			expect.objectContaining({ headers: { "arbor-from": "desktop" } }),
			expect.objectContaining({ headers: { "arbor-from": "phone" } }),
		]);
	});

	it("sends on Enter, keeps a new line on Shift+Enter, and stops a turn on Escape", async () => {
		const view = await testing.openConversations([conversation()]);
		const box = view.getByRole("textbox", {
			name: "Message input",
		});

		await typeIn(box, "hello");
		await act(async () =>
			fireEvent.keyDown(box, { key: "Enter", shiftKey: true }),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "hello" } },
		]);

		await testing.say(conversation({ status: "running" }));
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));
		expect(
			testing.posted("/api/conversations/c1/cancel").map((post) => post.method),
		).toEqual(["POST"]);
	});

	it("ends a turn the person stopped with a line that says so", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Stopped",
				messages: [
					message("user", "go"),
					{
						...message("agent", "Starting on it."),
						stopped: "2026-10-12T10:00:00.000Z",
					},
					message("user", "again"),
					message("agent", "Done."),
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Stopped" });

		await waitFor(() =>
			expect(thread.querySelectorAll('[data-slot="stopped"]')).toHaveLength(1),
		);
		expect(thread.querySelector('[data-slot="stopped"]')?.textContent).toBe(
			"Stopped by you",
		);
	});

	it("ends a turn a lost connection cut short with a line that says so", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Cut short",
				messages: [
					message("user", "go"),
					{
						...message("agent", "Starting on it."),
						interrupted: "2026-10-12T10:00:00.000Z",
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Cut short" });

		await waitFor(() =>
			expect(thread.querySelectorAll('[data-slot="interrupted"]')).toHaveLength(
				1,
			),
		);
		expect(
			thread.querySelector('[data-slot="interrupted"]')?.textContent,
		).toContain("Interrupted, connection lost");
	});

	it("offers to resume the turn a lost connection cut short, until something is said", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Cut short",
				status: "failed",
				messages: [
					message("user", "go"),
					{
						...message("agent", "Starting on it."),
						interrupted: "2026-10-12T10:00:00.000Z",
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Cut short" });

		await act(async () =>
			fireEvent.click(
				await within(thread).findByRole("button", { name: "Reconnect" }),
			),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: { text: "[ARBOR RECONNECT]" },
			},
		]);
	});

	it("leaves the turn a lost connection cut short as it ended while the agent comes back", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Cut short",
				status: "starting",
				messages: [
					message("user", "go"),
					{
						...message("agent", "Starting on it.", tool()),
						interrupted: "2026-10-12T10:00:00.000Z",
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Cut short" });

		await within(thread).findByText("Interrupted, connection lost");
		expect(within(thread).queryByText(/^Working/)).toBeNull();
	});
});
