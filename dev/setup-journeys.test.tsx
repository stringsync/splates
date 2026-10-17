import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { Setup, type SetupProgress } from "../setup";
import { SETUP_AREAS } from "../setup-areas";
import { SetupPage } from "./setup-page";
import { SetupContext } from "./setup-state";
import { act, cleanup, fireEvent, render, Testing } from "./testing";

describe("Selectable setup journeys", () => {
	let testing: Testing;
	let progress: SetupProgress;
	let setup: Setup;
	beforeEach(async () => {
		testing = new Testing();
		setup = new Setup(
			{ fs: new FakeFs(), home: "/fixture", device: new FakeSecretStore() },
			SETUP_AREAS,
		);
		progress = await setup.read();
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});
	function open() {
		return render(
			<SetupContext value={{ progress, refresh: () => {}, settle: () => {} }}>
				<SetupPage feed={null} onOpen={() => {}} />
			</SetupContext>,
		);
	}

	it("opens only the selected agent and retains other machine discovery", async () => {
		const view = open();
		expect(view.getByRole("button", { name: "Set up OpenCode" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Set up Claude" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Set up Codex" })).toBeTruthy();
		expect(
			view.getByRole("button", { name: "Set up Remote access" }),
		).toBeTruthy();
		expect(
			view.getByRole("button", { name: "Set up Notifications" }),
		).toBeTruthy();
		expect(view.getByRole("button", { name: "Set up Dictation" })).toBeTruthy();
		expect(testing.asked).not.toContain("/api/setup/opencode");
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Set up Claude" })),
		);
		expect(
			view.getByRole("article", { name: "step claude-roster" }),
		).toBeTruthy();
		expect(view.getByText("0 of 2 done")).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Next" })),
		);
		expect(
			view.getByRole("article", { name: "step claude-models" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Finish" })),
		);
		expect(view.queryByRole("article")).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Back to journeys" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Set up Codex" })),
		);
		expect(
			view.getByRole("article", { name: "step codex-roster" }),
		).toBeTruthy();
		expect(testing.posts).toEqual([]);
	});

	it("keeps OpenCode install, login, models and readiness in one repairable journey", async () => {
		const view = open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Set up OpenCode" })),
		);
		expect(
			view.getByRole("article", { name: "step opencode-install" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Next" })),
		);
		expect(
			view.getByRole("article", { name: "step opencode-connect" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Next" })),
		);
		expect(
			view.getByRole("article", { name: "step opencode-models" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Next" })),
		);
		expect(
			view.getByRole("article", { name: "step opencode-ready" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Revisit / repair setup" }),
			),
		);
		expect(
			view.getByRole("article", { name: "step opencode-install" }),
		).toBeTruthy();
		expect(testing.posts.map((post) => post.path)).toEqual([
			"/api/setup/opencode/cancel",
			"/api/setup/opencode/cancel",
		]);
	});

	it("stays on the step when skipping fails", async () => {
		const view = open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Set up Codex" })),
		);
		testing.refuseWrites = { reason: "failed", message: "Could not save skip" };
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Skip" })),
		);
		expect(view.getByRole("alert").textContent).toContain(
			"Could not save skip",
		);
		expect(
			view.getByRole("article", { name: "step codex-roster" }),
		).toBeTruthy();
	});

	it("resumes a skipped prerequisite when revisiting its dependent step", async () => {
		await setup.skip("codex-roster");
		progress = await setup.read();
		testing.reply = progress;
		const view = open();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Set up Codex" })),
		);
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "2. Review Codex models" }),
			),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Resume this step" })),
		);
		expect(testing.posted("/api/setup/codex-roster/skipped")[0]?.body).toEqual({
			skipped: false,
		});
		expect(testing.posted("/api/setup/codex-models/skipped")[0]?.body).toEqual({
			skipped: false,
		});
	});
});
