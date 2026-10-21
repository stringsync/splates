import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	type MoveProgress,
	SETUP_AREAS,
	Setup,
	type SetupProgress,
	type StepStatus,
} from "@stringsync/splates-server/setup";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { SetupPage } from "./setup-page";
import { SetupContext } from "./setup-state";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

const KEY = {
	slug: "app",
	key: "ssh-ed25519 AAAA splates-coordinator app",
	add: "https://github.com/me/app/settings/keys/new",
};

const RUNNING: MoveProgress = {
	moved: false,
	unfinished: false,
	running: true,
	exitCode: null,
	log: ["bringing splates on the box at 203.0.113.7 to 1.2.3"],
	host: "splates.example.com",
};

describe("Cloud server journey", () => {
	let testing: Testing;
	let progress: SetupProgress;
	beforeEach(async () => {
		testing = new Testing();
		const fs = new FakeFs();
		await fs.mkdir("/fixture", { recursive: true });
		progress = await new Setup(
			{ fs, home: "/fixture", device: new FakeSecretStore() },
			SETUP_AREAS,
		).read();
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** `progress` with the coordinator steps `statuses` names set so, and the keys step showing `keys`. */
	function with_(
		statuses: Record<string, StepStatus>,
		keys: (typeof KEY)[] | null = null,
	): SetupProgress {
		return {
			...progress,
			areas: progress.areas.map((area) => ({
				...area,
				steps: area.steps.map((step) => ({
					...step,
					status: statuses[step.id] ?? step.status,
					data:
						step.id === "coordinator-keys" && keys !== null
							? { keys }
							: step.data,
				})),
			})),
		};
	}

	function open(at: SetupProgress) {
		let settled = at;
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
	const click = (view: ReturnType<typeof open>, name: string) =>
		act(async () => fireEvent.click(view.getByRole("button", { name })));
	const before: Record<string, StepStatus> = {
		"coordinator-box": "done",
		"coordinator-remotes": "done",
	};

	it("opens on making the box, asking for no token", async () => {
		const view = open(progress);
		await click(view, "Set up Cloud server");

		expect(view.getByRole("form", { name: "Make the server's box" }));
		expect(view.queryByLabelText("API token")).toBeNull();
	});

	it("shows each deploy key a failed Next found, to copy and add on GitHub", async () => {
		const view = open(with_(before));
		await click(view, "Set up Cloud server");
		expect(view.getByRole("form", { name: "Let the box push each project" }));
		expect(view.queryByRole("list", { name: "deploy keys" })).toBeNull();
		testing.refuseWrites = {
			reason: "step",
			message: "GitHub does not let each deploy key push yet.",
		};
		testing.setup = with_(before, [KEY]);

		await click(view, "Next");

		await waitFor(() => view.getByRole("list", { name: "deploy keys" }));
		expect(view.getByRole("alert").textContent).toBe(
			"GitHub does not let each deploy key push yet.",
		);
		expect(view.getByText(KEY.key)).toBeTruthy();
		expect(
			view.getByRole("link", { name: "Add it on GitHub" }).getAttribute("href"),
		).toBe(KEY.add);
		expect(view.getByRole("button", { name: "Copy app's key" })).toBeTruthy();
	});

	it("starts the move on Next and says what it is doing", async () => {
		const view = open(with_({ ...before, "coordinator-keys": "done" }));
		await click(view, "Set up Cloud server");
		expect(view.getByRole("form", { name: "Deploy the server to its box" }));
		testing.reply = RUNNING;
		testing.coordinatorMove = RUNNING;

		await click(view, "Finish");

		await waitFor(() =>
			expect(view.getByText(RUNNING.log[0] as string)).toBeTruthy(),
		);
		expect(testing.posted("/api/setup/coordinator/move")).toHaveLength(1);
		expect(testing.posted("/api/setup/coordinator-move/next")).toEqual([]);
	});
});
