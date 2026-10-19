import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	SETUP_AREAS,
	Setup,
	type SetupProgress,
	type StepStatus,
} from "@stringsync/splates-server/setup";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { SetupIndex, StepForm } from "./setup-form";
import { SetupPage } from "./setup-page";
import { SetupContext } from "./setup-state";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

describe("Setup journeys", () => {
	let testing: Testing;
	let progress: SetupProgress;
	beforeEach(async () => {
		testing = new Testing();
		progress = await new Setup(
			{ fs: new FakeFs(), home: "/fixture", device: new FakeSecretStore() },
			SETUP_AREAS,
		).read();
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});
	function open() {
		let settled = progress;
		const view = render(<Page />);
		function Page() {
			return (
				<SetupContext
					value={{
						progress: settled,
						refresh: () => {},
						settle: (fresh) => {
							settled = fresh;
							view.rerender(<Page />);
						},
					}}
				>
					<SetupPage feed={null} onOpen={() => {}} todos={[]} />
				</SetupContext>
			);
		}
		return view;
	}
	/** `progress` with the steps `statuses` names set so. */
	function with_(statuses: Record<string, StepStatus>): SetupProgress {
		return {
			...progress,
			areas: progress.areas.map((area) => {
				const steps = area.steps.map((step) => ({
					...step,
					status: statuses[step.id] ?? step.status,
				}));
				return {
					...area,
					steps,
					done: steps.filter((step) => step.status === "done").length,
				};
			}),
		};
	}
	const click = (view: ReturnType<typeof open>, name: string) =>
		act(async () => fireEvent.click(view.getByRole("button", { name })));

	it("asks one page at a time, Next doing the step, until the journey is set up", async () => {
		const view = open();
		expect(view.getByRole("button", { name: "Set up OpenCode" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Set up Dictation" })).toBeTruthy();
		await click(view, "Set up Claude");

		expect(view.getByRole("form", { name: "Install and sign in to Claude" }));
		expect(view.getByText("1 of 2")).toBeTruthy();
		expect(view.queryByRole("progressbar")).toBeNull();
		expect(view.queryByRole("button", { name: "Back" })).toBeNull();
		expect(view.queryByRole("button", { name: "Skip" })).toBeNull();

		testing.reply = with_({ "claude-signin": "done" });
		await click(view, "Next");
		expect(testing.posted("/api/setup/claude-signin/next")[0]?.body).toEqual({
			answers: {},
		});
		await waitFor(() =>
			view.getByRole("form", { name: "Choose Claude models" }),
		);
		expect(view.getByText("2 of 2")).toBeTruthy();
		expect(
			view
				.getAllByRole("switch")
				.every((each) => each.getAttribute("aria-checked") === "true"),
		).toBe(true);

		testing.reply = with_({ "claude-signin": "done", "claude-models": "done" });
		await click(view, "Finish");
		await waitFor(() => view.getByText("Claude is set up"));
		await click(view, "Back to setup");
		expect(
			view.getByRole("button", { name: "Set up Claude Done" }),
		).toBeTruthy();
		expect(testing.asked).not.toContain("/api/setup/opencode");
	});

	it("stays on the page with one line on what went wrong, Next becoming Try again", async () => {
		const view = open();
		await click(view, "Set up Codex");
		testing.refuseWrites = {
			reason: "step",
			message: "Codex is not installed here.",
		};

		await click(view, "Next");

		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toBe(
				"Codex is not installed here.",
			),
		);
		expect(view.getByRole("form", { name: "Install and sign in to Codex" }));
		testing.refuseWrites = null;
		testing.reply = with_({ "codex-signin": "done" });
		await click(view, "Try again");
		await waitFor(() =>
			view.getByRole("form", { name: "Choose Codex models" }),
		);
	});

	it("opens a journey at its first step not done, and a finished one at its first", async () => {
		progress = with_({ "codex-signin": "done", dictation: "done" });
		const view = open();
		await click(view, "Set up Codex");
		expect(view.getByRole("form", { name: "Choose Codex models" }));
		await click(view, "Setup");
		await click(view, "Set up Dictation Done");
		expect(view.getByRole("form", { name: "Dictate prompts" }));
	});

	it("saves a pasted cred for the device before Next checks the step", async () => {
		const view = open();
		await click(view, "Set up Dictation");
		fireEvent.change(view.getByLabelText("OpenAI API key"), {
			target: { value: " sk-secret " },
		});
		testing.reply = with_({ dictation: "done" });

		await click(view, "Finish");

		await waitFor(() => view.getByText("Dictation is set up"));
		expect(testing.posted("/api/creds/OPENAI_API_KEY")[0]?.body).toEqual({
			value: "sk-secret",
			scope: "device",
		});
		expect(testing.posted("/api/setup/dictation/next")[0]?.body).toEqual({
			answers: {},
		});
	});

	it("asks OpenCode's models on one page, and ends offering to turn it off", async () => {
		progress = with_({
			"opencode-install": "done",
			"opencode-connect": "done",
		});
		const view = open();
		await click(view, "Set up OpenCode");
		expect(view.getByRole("form", { name: "Choose your models" }));
		expect(view.getByLabelText("Main model")).toBeTruthy();
		expect(view.getByLabelText("Auxiliary model, for titles")).toBeTruthy();
		fireEvent.click(
			view.getByLabelText("Use balance is off in my OpenCode Console"),
		);
		testing.reply = with_({
			"opencode-install": "done",
			"opencode-connect": "done",
			"opencode-models": "done",
			"opencode-ready": "done",
		});

		await click(view, "Next");

		await waitFor(() => view.getByText("OpenCode is set up"));
		expect(
			testing.posted("/api/setup/opencode-models/next")[0]?.body,
		).toMatchObject({ answers: { balanceOff: true } });
		await click(view, "Turn OpenCode off");
		expect(testing.posted("/api/setup/opencode/disable")).toHaveLength(1);
	});

	it("lists areas as rows, marking those with every step done, and offers Undo on those with any", () => {
		const undone: string[] = [];
		const view = render(
			<SetupIndex
				areas={progress.areas.map((area) => ({
					...area,
					done: area.id === "claude" ? area.steps.length : 0,
				}))}
				onSelect={() => {}}
				onUndo={(id) => undone.push(id)}
			/>,
		);
		const rows = view
			.getAllByRole("button", { name: /^Set up/ })
			.map((row) => row.textContent);
		expect(rows.slice(0, 3)).toEqual([
			"Set up OpenCode",
			"Set up Claude Done",
			"Set up Codex",
		]);
		expect(
			view
				.getAllByRole("button", { name: /^Undo/ })
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["Undo Claude"]);
		fireEvent.click(view.getByRole("button", { name: "Undo Claude" }));
		expect(undone).toEqual(["claude"]);
	});

	it("asks one question, with Next becoming Try again once it fails", () => {
		let nexts = 0;
		const view = render(
			<StepForm
				title="Install OpenCode"
				at={2}
				of={4}
				next={{ kind: "failed", problem: "npm is not on your PATH." }}
				onNext={() => nexts++}
				onAgent={null}
				onLeave={() => {}}
			/>,
		);
		expect(view.getByText("2 of 4")).toBeTruthy();
		expect(view.getByRole("alert").textContent).toBe(
			"npm is not on your PATH.",
		);
		fireEvent.click(view.getByRole("button", { name: "Try again" }));
		expect(nexts).toBe(1);
		expect(view.queryByRole("button", { name: "Back" })).toBeNull();
	});
});
