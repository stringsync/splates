import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SetupProgress, StepProgress } from "../setup";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
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
	});

	/** Opens Setup the way a person does once the nudge is gone: from Settings. */
	const openSetup = async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "More" })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("menuitem", { name: "Settings" })),
			),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Set up arbor" })),
			),
		);
		return view;
	};

	const step = (view: Awaited<ReturnType<Testing["open"]>>, id: string) =>
		waitFor(() => view.getByRole("article", { name: `step ${id}` }));

	const posted = (path: string) =>
		testing.posted(path).map((post) => post.body);

	it("has no entry of its own in the nav", async () => {
		testing.setup = progress();
		const view = await testing.open();

		expect(view.queryByRole("tab", { name: /Setup/ })).toBeNull();
	});

	it("asks the next step first, with progress, why and the one thing to do", async () => {
		testing.setup = progress({ agents: "done", next: "dictation" });
		const view = await openSetup();

		const current = await step(view, "dictation");
		expect(current.textContent).toContain("Dictate prompts");
		expect(current.textContent).toContain("The mic transcribes on your key.");
		expect(current.textContent).toContain("Paste an OpenAI key.");
		expect(
			view
				.getByRole("progressbar", { name: "setup done" })
				.getAttribute("aria-valuenow"),
		).toBe("1");
		expect(view.getByText("1 of 2 done")).toBeTruthy();
	});

	it("goes back and forward through the steps, to an end", async () => {
		testing.setup = progress();
		const view = await openSetup();
		await step(view, "agents");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Next" })),
		);
		await step(view, "dictation");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Back" })),
		);
		await step(view, "agents");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Next" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Finish" })),
		);

		expect(view.getByText("That's every step.")).toBeTruthy();
	});

	it("skips an optional step and moves on, but offers no skip on a required one", async () => {
		testing.setup = progress({ agents: "done", next: "dictation" });
		const view = await openSetup();
		await step(view, "dictation");
		testing.reply = progress({ agents: "done", dictation: "skipped" });

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Skip" })),
		);

		expect(posted("/api/setup/dictation/skipped")).toEqual([{ skipped: true }]);
		await waitFor(() =>
			expect(view.getByText("That's every step.")).toBeTruthy(),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Back" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Back" })),
		);
		await step(view, "agents");
		expect(view.queryByRole("button", { name: "Skip" })).toBeNull();
	});

	it("checks a step again, showing it done", async () => {
		testing.setup = progress();
		const view = await openSetup();
		const current = await step(view, "agents");
		testing.setup = progress({ agents: "done", next: "dictation" });

		await act(async () =>
			fireEvent.click(
				within(current).getByRole("button", { name: "Check again" }),
			),
		);

		await waitFor(() =>
			expect(
				view.getByRole("article", { name: "step agents" }).textContent,
			).toContain("Done"),
		);
	});

	it("saves a step's cred in place, for the device", async () => {
		testing.setup = progress({ agents: "done", next: "dictation" });
		const view = await openSetup();
		const current = await step(view, "dictation");

		fireEvent.change(
			within(current).getByLabelText("Value of OPENAI_API_KEY"),
			{
				target: { value: "sk-secret" },
			},
		);
		await act(async () =>
			fireEvent.click(within(current).getByRole("button", { name: "Save" })),
		);

		expect(posted("/api/creds/OPENAI_API_KEY")).toEqual([
			{ value: "sk-secret", scope: "device" },
		]);
	});

	it("starts an agent on the step, sent the setup directive", async () => {
		testing.setup = progress();
		testing.talk = { agents: AGENTS, conversations: [] };
		const view = await openSetup();
		const current = await step(view, "agents");
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
				{ text: "[ARBOR SETUP agents]" },
			]),
		);
	});

	it("opens from Settings", async () => {
		testing.setup = progress();
		const view = await openSetup();

		expect(location.hash).toBe("#setup");
		await step(view, "agents");
	});

	it("nudges a fresh machine towards Setup from the foot of the nav until it is opened", async () => {
		testing.setup = progress({ fresh: true });
		const view = await testing.open();
		const nudge = await waitFor(() =>
			view.getByRole("complementary", { name: "set up arbor" }),
		);
		testing.reply = progress();

		await act(async () =>
			fireEvent.click(
				within(nudge).getByRole("button", { name: "Open Setup" }),
			),
		);

		expect(location.hash).toBe("#setup");
		await waitFor(() =>
			expect(testing.posted("/api/setup/seen")).toHaveLength(1),
		);
		expect(
			view.queryByRole("complementary", { name: "set up arbor" }),
		).toBeNull();
	});

	it("puts the nudge off with Not now", async () => {
		testing.setup = progress({ fresh: true });
		const view = await testing.open();
		const nudge = await waitFor(() =>
			view.getByRole("complementary", { name: "set up arbor" }),
		);
		testing.reply = progress();

		await act(async () =>
			fireEvent.click(within(nudge).getByRole("button", { name: "Not now" })),
		);

		await waitFor(() =>
			expect(
				view.queryByRole("complementary", { name: "set up arbor" }),
			).toBeNull(),
		);
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
		title: "Choose the agents arbor starts",
		why: "Only agents on the roster start.",
		user: "Say which agents you have.",
		agent: "Run `arbor agents`.",
		optional: false,
		after: [],
		status: agents,
		problem: null,
		cred: null,
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
