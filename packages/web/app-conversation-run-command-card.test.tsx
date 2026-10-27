import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setSystemTime,
} from "bun:test";
import type { MachineStatus } from "./api";
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

describe("App's run-command card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the command and answers Allow with its directive at once", async () => {
		const asking = conversation({
			title: "Build",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run command: build the web app\n\n`bun run build`\n\nAbout two minutes.",
				),
			],
		});
		const view = await testing.openConversations([asking]);
		await waitFor(() => expect(view.getByText("bun run build")).toBeTruthy());
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Allow/ })),
		);
		await waitFor(() => expect(view.getByText("Allowed")).toBeTruthy());
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES RUN ALLOWED]" } },
		]);
		expect(testing.posted("/api/conversations/c1/suite")).toEqual([]);
	});

	it("starts the ship from its Ship rather than letting the agent run it", async () => {
		const asking = conversation({
			title: "Release",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run command: ship webappwiz\n\n`splates ship webappwiz`\n\nThe log fix is on main and unreleased.",
				),
			],
		});
		const view = await testing.openConversations([asking]);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Ship" })),
			),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[SPLATES RUN ALLOWED]" } },
			]),
		);
		expect(testing.posted("/api/ship?project=webappwiz")).toHaveLength(1);
	});

	it("sends Anything else with Allow and keeps it in the reopened card", async () => {
		const view = await testing.openConversations([asking()]);
		await typeIn(
			view.getByRole("textbox", { name: "Anything else" }),
			"Please keep the output.\nI need it for review.",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Allow" })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: `[SPLATES RUN ALLOWED]\n\n> **Anything else?**\n\nPlease keep the output.\nI need it for review.`,
					},
				},
			]),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open" })),
		);
		expect(view.getAllByText(/Please keep the output/).length).toBeGreaterThan(
			0,
		);
		expect(view.queryByRole("textbox", { name: "Anything else" })).toBeNull();
		expect(testing.posted("/api/conversations/c1/suite")).toEqual([]);
	});

	it("sends Anything else with Deny and keeps it in the reopened card", async () => {
		const view = await testing.openConversations([asking()]);
		await typeIn(
			view.getByRole("textbox", { name: "Anything else" }),
			"Please keep the output.\nI need it for review.",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Deny" })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: `[SPLATES RUN DENIED]\n\n> **Anything else?**\n\nPlease keep the output.\nI need it for review.`,
					},
				},
			]),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open" })),
		);
		expect(view.getAllByText(/Please keep the output/).length).toBeGreaterThan(
			0,
		);
		expect(view.queryByRole("textbox", { name: "Anything else" })).toBeNull();
		expect(testing.posted("/api/conversations/c1/suite")).toEqual([]);
	});

	it("grants the whole test suite's one run before telling the agent to run it", async () => {
		const asking = conversation({
			title: "Imports",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run command: the move touches every import\n\n`bin/splates dev test`\n\n`--changed` picks most of the suite anyway.",
				),
			],
		});
		const view = await testing.openConversations([asking]);
		await waitFor(() =>
			expect(view.getByText("bin/splates dev test")).toBeTruthy(),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Allow/ })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[SPLATES RUN ALLOWED]" } },
			]),
		);
		expect(
			testing.posts
				.map((each) => each.path)
				.filter((path) => path.startsWith("/api/conversations/c1/")),
		).toEqual(["/api/conversations/c1/suite", "/api/conversations/c1/prompt"]);
	});

	it("reads the machine each second while it waits, keeping the last reading with its age when asking fails", async () => {
		testing.machine = reading({ cpu: 0.23 });
		const view = await testing.openConversations([asking()]);
		const cpu = () =>
			within(view.getByRole("region", { name: "This Mac" })).getByLabelText(
				"CPU",
			).textContent;
		await waitFor(() => expect(cpu()).toContain("23%"));

		testing.machine = reading({ cpu: 0.71 });
		await waitFor(() => expect(cpu()).toContain("71%"), { timeout: 2500 });
		expect(view.queryByText(/s ago/)).toBeNull();

		testing.machine = null;
		setSystemTime(new Date(Date.now() + 10_000));
		try {
			await waitFor(() => expect(view.getByText(/1\ds ago/)).toBeTruthy(), {
				timeout: 2500,
			});
			expect(cpu()).toContain("71%");
		} finally {
			setSystemTime();
		}
	});

	it("shows dashes, not numbers, before the machine has been read", async () => {
		const view = await testing.openConversations([asking()]);
		const stats = await waitFor(() =>
			view.getByRole("region", { name: "This machine" }),
		);
		expect(within(stats).getByLabelText("CPU").textContent).toContain("-");
		expect(within(stats).getByLabelText("Memory").textContent).toContain("-");
	});
});

function asking() {
	return conversation({
		title: "Build",
		messages: [
			message(
				"agent",
				"## 🔐 Permission: run command: build the web app\n\n`bun run build`",
			),
		],
	});
}

function reading(overrides: Partial<MachineStatus> = {}): MachineStatus {
	return {
		kind: "Mac",
		cpu: 0.23,
		memory: 0.61,
		load: 3.2,
		cores: 16,
		temperature: null,
		queue: [],
		...overrides,
	};
}
