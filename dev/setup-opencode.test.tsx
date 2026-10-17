import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenCodeControls } from "./setup-opencode";
import { SetupPage } from "./setup-page";
import { SetupContext } from "./setup-state";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

describe("OpenCode wizard controls", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("waits for explicit checks and offers an explicit install without prompting an agent", async () => {
		const view = render(<OpenCodeControls step="opencode-install" />);
		await waitFor(() => expect(testing.asked).toContain("/api/setup/opencode"));
		expect(testing.posts).toEqual([]);
		expect(
			view.getByRole("button", { name: "Install OpenCode with npm" }),
		).toBeTruthy();
		expect(view.queryByRole("button", { name: /agent/ })).toBeNull();
		testing.reply = {
			...testing.opencode,
			version: "2.0.0-fixture",
			protocol: "compatible",
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Check again" })),
		);
		await waitFor(() =>
			expect(view.getByText(/OpenCode 2.0.0-fixture/)).toBeTruthy(),
		);
		expect(testing.posted("/api/setup/opencode/check")).toHaveLength(1);
		expect(
			(
				view.getByRole("button", {
					name: "Install OpenCode with npm",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("shows protocol errors and retries without claiming a connection", async () => {
		testing.opencode = {
			...testing.opencode,
			version: "2.0.0-fixture",
			auth: "missing",
			protocol: "failed",
			problem: "ACP handshake failed. Retry.",
		};
		const view = render(<OpenCodeControls step="opencode-connect" />);
		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain("handshake failed"),
		);
		expect(
			view
				.getByRole("link", { name: "Open OpenCode Console" })
				.getAttribute("href"),
		).toBe("https://opencode.ai/auth");
		testing.reply = {
			...testing.opencode,
			auth: "stored",
			protocol: "compatible",
			problem: null,
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Check again" })),
		);
		await waitFor(() =>
			expect(
				view.getByText(/Subscription access and billing are not verified/),
			).toBeTruthy(),
		);
		expect(view.queryByRole("alert")).toBeNull();
	});

	it("does not enable native key entry for unsupported login interfaces", async () => {
		testing.opencode = {
			...testing.opencode,
			version: "1.0.0",
			auth: "unsupported",
		};
		const view = render(<OpenCodeControls step="opencode-connect" />);
		await waitFor(() => expect(view.getByText(/OpenCode 1.0.0/)).toBeTruthy());
		expect(
			(
				view.getByRole("button", {
					name: "Connect existing Go account",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("offers cancellation while a check is pending", async () => {
		const view = render(<OpenCodeControls step="opencode-connect" />);
		testing.holdWrites();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Check again" })),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Cancel check" })),
		);
		expect(testing.posted("/api/setup/opencode/cancel")).toHaveLength(1);
		testing.reply = {
			...testing.opencode,
			problem: "Check canceled. You can retry.",
		};
		await act(async () => testing.release());
		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain("canceled"),
		);
	});

	it("keeps the native controls in the existing wizard and its skip/back flow", async () => {
		const progress = {
			areas: [
				{
					id: "opencode",
					title: "OpenCode",
					done: 0,
					skipped: 0,
					left: 1,
					steps: [
						{
							id: "opencode-install",
							title: "Install OpenCode",
							why: "Optional",
							user: "Check this machine.",
							agent: "",
							optional: true,
							after: [],
							status: "ready" as const,
							problem: null,
							cred: null,
						},
					],
				},
			],
			next: "opencode-install",
			fresh: false,
			required: false,
		};
		testing.reply = progress;
		const view = render(
			<SetupContext value={{ progress, refresh: () => {}, settle: () => {} }}>
				<SetupPage feed={null} onOpen={() => {}} />
			</SetupContext>,
		);
		expect(
			view.getByRole("article", { name: "step opencode-install" }),
		).toBeTruthy();
		expect(
			view.queryByRole("button", { name: "Set it up with an agent" }),
		).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Skip" })),
		);
		expect(testing.posted("/api/setup/opencode-install/skipped")).toHaveLength(
			1,
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Back" })),
		);
		expect(
			view.getByRole("button", { name: "Install OpenCode with npm" }),
		).toBeTruthy();
	});
});
