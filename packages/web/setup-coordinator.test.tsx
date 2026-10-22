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

const NEEDS = ["/splates/device/SPLATES_TUNNEL_TOKEN"];

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

	/** `progress` with the coordinator steps `statuses` names set so, and the creds step listing `needs`. */
	function with_(
		statuses: Record<string, StepStatus>,
		needs: string[] | null = null,
	): SetupProgress {
		return {
			...progress,
			areas: progress.areas.map((area) => ({
				...area,
				steps: area.steps.map((step) => ({
					...step,
					status: statuses[step.id] ?? step.status,
					data:
						step.id === "coordinator-creds" && needs !== null
							? { needs }
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
		"coordinator-access": "done",
		"coordinator-pulumi": "done",
		"coordinator-infra": "done",
		"coordinator-secret-cloudflare": "done",
		"coordinator-secret-anthropic": "done",
		"coordinator-up": "done",
		"coordinator-remotes": "done",
	};

	it("opens on Pulumi, asking for no token", async () => {
		const view = open(progress);
		await click(view, "Set up Cloud server");

		expect(view.getByRole("form", { name: "Install Pulumi and log in" }));
		expect(
			view.queryByLabelText(/API token/, { selector: "input" }),
		).toBeNull();
	});

	it("signs in to AWS with CloudShell's line and the account id it prints", async () => {
		const at = with_({ "coordinator-pulumi": "done" });
		const view = open({
			...at,
			areas: at.areas.map((area) => ({
				...area,
				steps: area.steps.map((step) =>
					step.id === "coordinator-access"
						? {
								...step,
								data: {
									cloudShell: "https://console.aws.amazon.com/cloudshell/home",
									command: "aws cloudformation deploy PulumiOrg=acme",
									environment: "acme/splates/aws",
								},
							}
						: step,
				),
			})),
		});
		await click(view, "Set up Cloud server");

		expect(view.getByRole("form", { name: "Sign in to AWS" }));
		expect(
			view
				.getByRole("link", { name: "Open AWS CloudShell" })
				.getAttribute("href"),
		).toBe("https://console.aws.amazon.com/cloudshell/home");
		expect(view.getByText("aws cloudformation deploy PulumiOrg=acme"));
		expect(view.getByRole("button", { name: "Copy the command" }));
		expect(view.getByLabelText("AWS account id"));
	});

	it("lists each cred the box lacks after a failed Next", async () => {
		const view = open(with_(before));
		await click(view, "Set up Cloud server");
		expect(view.getByRole("form", { name: "Give the box its creds" }));
		expect(view.queryByRole("list", { name: "missing creds" })).toBeNull();
		testing.refuseWrites = {
			reason: "step",
			message: "The box lacks creds in its Parameter Store.",
		};
		testing.setup = with_(before, NEEDS);

		await click(view, "Next");

		await waitFor(() => view.getByRole("list", { name: "missing creds" }));
		expect(view.getByRole("alert").textContent).toBe(
			"The box lacks creds in its Parameter Store.",
		);
		expect(view.getByText(NEEDS[0] as string)).toBeTruthy();
	});

	it("starts the move on Next and says what it is doing", async () => {
		const view = open(with_({ ...before, "coordinator-creds": "done" }));
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
