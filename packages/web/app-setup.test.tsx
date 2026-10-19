import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	SetupProgress,
	StepProgress,
} from "@stringsync/splates-server/setup";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

const AGENTS = [{ id: "claude", name: "Claude", settings: [], limits: [] }];

describe("App's setup", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	/** Opens Setup the way a person does: from its tab in the sidebar. */
	const openSetup = async (journey: string | null = "Agents") => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Setup$/ })),
		);
		if (journey !== null) {
			await act(async () =>
				fireEvent.click(
					await waitFor(() =>
						view.getByRole("button", { name: `Set up ${journey}` }),
					),
				),
			);
		}
		return view;
	};

	/** The page a step's form is on, by its title. */
	const step = (view: Awaited<ReturnType<Testing["open"]>>, title: string) =>
		waitFor(() => view.getByRole("form", { name: title }));

	const posted = (path: string) =>
		testing.posted(path).map((post) => post.body);

	it("has a tab in the nav, dotted while a required step is left", async () => {
		testing.setup = progress();
		const view = await testing.open();

		const tab = await waitFor(() => view.getByRole("tab", { name: /Setup$/ }));
		await waitFor(() =>
			within(tab).getByRole("img", { name: "setup unfinished" }),
		);
	});

	it("leaves the tab undotted once only optional steps are left", async () => {
		testing.setup = progress({ agents: "done", required: false });
		const view = await testing.open();

		const tab = await waitFor(() => view.getByRole("tab", { name: /Setup$/ }));
		expect(
			within(tab).queryByRole("img", { name: "setup unfinished" }),
		).toBeNull();
	});

	it("asks a journey's step as one page, its why and its field", async () => {
		testing.setup = progress({ agents: "done", next: "dictation" });
		const view = await openSetup("Dictation");

		const current = await step(view, "Dictate prompts");
		expect(current.textContent).toContain("The mic transcribes on your key.");
		expect(within(current).getByLabelText("OpenAI API key")).toBeTruthy();
		expect(current.textContent).toContain("1 of 1");
		expect(
			within(current).getByRole("button", { name: "Finish" }),
		).toBeTruthy();
	});

	it("returns to the index from a journey without starting work", async () => {
		testing.setup = progress();
		const view = await openSetup(null);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Set up Agents" })),
		);
		await step(view, "Choose the agents splates starts");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Setup" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Set up Dictation" })),
		);
		await step(view, "Dictate prompts");
		expect(testing.posts).toEqual([]);
	});

	it("moves on once Next finds the step done", async () => {
		testing.setup = progress();
		const view = await openSetup();
		await step(view, "Choose the agents splates starts");
		testing.reply = progress({ agents: "done", next: "dictation" });

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Finish" })),
		);

		expect(posted("/api/setup/agents/next")).toEqual([{ answers: {} }]);
		await waitFor(() => view.getByText("Agents is set up"));
	});

	it("starts an agent on the step, sent the setup directive", async () => {
		testing.setup = progress();
		testing.talk = { agents: AGENTS, conversations: [] };
		const view = await openSetup();
		const current = await step(view, "Choose the agents splates starts");
		testing.reply = conversation({ id: "c9", status: "starting" });

		await act(async () =>
			fireEvent.click(
				within(current).getByRole("button", {
					name: "Set it up with an agent",
				}),
			),
		);

		expect(posted("/api/conversations")).toEqual([
			{ agent: "claude", task: null, settings: {} },
		]);
		await waitFor(() =>
			expect(posted("/api/conversations/c9/prompt")).toEqual([
				{ text: "[SPLATES SETUP agents]" },
			]),
		);
	});

	it("opens from its tab in the sidebar", async () => {
		testing.setup = progress();
		const view = await openSetup();

		expect(location.hash).toBe("#setup");
		await step(view, "Choose the agents splates starts");
	});

	it("opens from the phone menu", async () => {
		testing.setup = progress();
		resize(390, 844);
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		await act(async () =>
			fireEvent.click(await waitFor(() => view.getByText("Setup"))),
		);

		expect(location.hash).toBe("#setup");
	});

	it("opens from the link under Settings' notifications, not from a button for all of setup", async () => {
		testing.setup = progress();
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Settings" })),
			),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(
			within(dialog).queryByRole("button", { name: "Set up splates" }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Notifications" }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Set up notifications" }),
			),
		);

		expect(location.hash).toBe("#setup");
	});

	it("never nudges a fresh machine on desktop", async () => {
		testing.setup = progress({ fresh: true });
		const view = await testing.open();
		expect(
			view.queryByRole("complementary", { name: "set up splates" }),
		).toBeNull();
		expect(view.queryByRole("button", { name: "Open Setup" })).toBeNull();
		expect(testing.posts).toEqual([]);
		expect(location.hash).not.toBe("#setup");
	});

	it("never nudges a fresh machine in the phone menu", async () => {
		testing.setup = progress({ fresh: true });
		resize(390, 844);
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Open menu" })),
		);
		expect(
			view.queryByRole("complementary", { name: "set up splates" }),
		).toBeNull();
		expect(view.queryByRole("button", { name: "Open Setup" })).toBeNull();
		expect(testing.posts).toEqual([]);
		expect(location.hash).not.toBe("#setup");
	});
});

/** Two areas, agents required and dictation optional, as the server reads them. */
function progress({
	next = "agents",
	required = true,
	fresh = false,
	agents = "ready",
	dictation = "ready",
}: {
	next?: string | null;
	required?: boolean;
	fresh?: boolean;
	agents?: StepProgress["status"];
	dictation?: StepProgress["status"];
} = {}): SetupProgress {
	const agentsStep: StepProgress = {
		id: "agents",
		title: "Choose the agents splates starts",
		why: "Only agents on the roster start.",
		user: "Say which agents you have.",
		agent: "Run `splates agents`.",
		optional: false,
		after: [],
		status: agents,
		problem: null,
		cred: null,
		fields: [],
		doing: null,
		detail: null,
		data: null,
	};
	const dictationStep: StepProgress = {
		id: "dictation",
		title: "Dictate prompts",
		why: "The mic transcribes on your key.",
		user: "Paste an OpenAI key.",
		agent: "Request the key.",
		optional: true,
		after: [],
		status: dictation,
		problem: null,
		cred: "OPENAI_API_KEY",
		fields: [
			{
				kind: "cred",
				name: "OPENAI_API_KEY",
				label: "OpenAI API key",
				help: null,
				saved: false,
			},
		],
		doing: null,
		detail: null,
		data: null,
	};
	const area = (id: string, title: string, step: StepProgress) => ({
		id,
		title,
		done: step.status === "done" ? 1 : 0,
		skipped: step.status === "skipped" ? 1 : 0,
		left: step.status === "ready" || step.status === "waiting" ? 1 : 0,
		steps: [step],
	});
	return {
		areas: [
			area("agents", "Agents", agentsStep),
			area("dictation", "Dictation", dictationStep),
		],
		next,
		fresh,
		required,
	};
}
