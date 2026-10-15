import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CredRequest } from "../creds";
import { pasteAndSave, REQUEST } from "./creds-testing";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

describe("App's creds", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const openCreds = async (creds: CredRequest[]) => {
		const view = await testing.open({ creds });
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Creds/ })),
		);
		return view;
	};

	it("dots Creds in the menu while a request waits, and counts nothing", async () => {
		const view = await testing.open({ creds: [REQUEST] });

		const tab = view.getByRole("tab", { name: /Creds/ });
		expect(
			within(tab).getByRole("img", { name: "creds requested" }),
		).toBeTruthy();
		expect(tab.textContent).toBe("Creds");
	});

	it("leaves Creds plain once nothing waits", async () => {
		const view = await testing.open({
			creds: [{ ...REQUEST, status: "saved" }],
		});

		const tab = view.getByRole("tab", { name: /Creds/ });
		expect(
			within(tab).queryByRole("img", { name: "creds requested" }),
		).toBeNull();
	});

	it("shows a request with what it is for and how to get it, and saves what is pasted", async () => {
		const view = await openCreds([REQUEST]);

		const request = await waitFor(() =>
			view.getByRole("listitem", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		expect(request.textContent).toContain(
			"To route arbor.example.com to arbor dev.",
		);
		expect(request.textContent).toContain("Open API Tokens and create one.");
		expect(request.textContent).toContain("all projects");
		fireEvent.change(
			within(request).getByLabelText("Value of CLOUDFLARE_TOKEN"),
			{ target: { value: "cf-secret" } },
		);
		await act(async () =>
			fireEvent.click(within(request).getByRole("button", { name: "Save" })),
		);

		expect(testing.posted("/api/creds/CLOUDFLARE_TOKEN")).toEqual([
			{ method: "PUT", body: { value: "cf-secret" } },
		]);
		await waitFor(() =>
			expect(
				within(request).getByRole("button", { name: "Saved" }),
			).toBeTruthy(),
		);
		expect(
			(
				within(request).getByLabelText(
					"Value of CLOUDFLARE_TOKEN",
				) as HTMLInputElement
			).value,
		).toBe("");
	});

	it("dismisses a request", async () => {
		const view = await openCreds([REQUEST]);

		const request = await waitFor(() =>
			view.getByRole("listitem", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		await act(async () =>
			fireEvent.click(within(request).getByRole("button", { name: "Dismiss" })),
		);

		expect(testing.posted("/api/creds/CLOUDFLARE_TOKEN/dismiss")).toHaveLength(
			1,
		);
	});

	it("lists what is kept by name, and removes one only once confirmed", async () => {
		testing.kept = {
			...testing.kept,
			kept: [
				{ name: "DATABASE_URL", scope: "project", savedBy: null },
				{
					name: "TUNNEL_TOKEN",
					scope: "device",
					savedBy: "arbor tunnel setup",
				},
			],
		};
		const view = await openCreds([]);

		const row = await waitFor(() =>
			view.getByRole("listitem", { name: "TUNNEL_TOKEN" }),
		);
		expect(row.textContent).toContain("saved by arbor tunnel setup");
		expect(view.getByText(/in the macOS Keychain\./)).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(row).getByRole("button", { name: "Remove" })),
		);
		expect(testing.posts).toHaveLength(0);
		await act(async () =>
			fireEvent.click(
				within(row).getByRole("button", { name: "Remove TUNNEL_TOKEN" }),
			),
		);

		expect(testing.posted("/api/creds/TUNNEL_TOKEN?scope=device")).toEqual([
			{ method: "DELETE", body: {} },
		]);
	});

	it("removes a cred being added without saving it", async () => {
		const view = await openCreds([]);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add" })),
		);
		fireEvent.change(view.getByLabelText("Name"), {
			target: { value: "STRIPE_KEY" },
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Remove" })),
		);

		expect(view.queryByLabelText("Name")).toBeNull();
		expect(view.queryByLabelText("Value of STRIPE_KEY")).toBeNull();
		expect(testing.posts).toHaveLength(0);
	});

	it("keeps a value pasted on a requested cred to its store alone", async () => {
		const view = await openCreds([REQUEST]);

		const request = await waitFor(() =>
			view.getByRole("listitem", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		await pasteAndSave(
			testing,
			within(request).getByLabelText("Value of CLOUDFLARE_TOKEN"),
			"cf-page-secret",
		);
	});

	it("keeps a replaced value to its store alone", async () => {
		testing.kept = {
			...testing.kept,
			kept: [{ name: "DATABASE_URL", scope: "project", savedBy: null }],
		};
		const view = await openCreds([]);

		const row = await waitFor(() =>
			view.getByRole("listitem", { name: "DATABASE_URL" }),
		);
		await act(async () =>
			fireEvent.click(within(row).getByRole("button", { name: "Replace" })),
		);
		await pasteAndSave(
			testing,
			within(row).getByLabelText("Value of DATABASE_URL"),
			"postgres://replaced-secret",
		);
	});

	it("keeps an added value to its store alone", async () => {
		const view = await openCreds([]);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Add" })),
		);
		fireEvent.change(view.getByLabelText("Name"), {
			target: { value: "STRIPE_KEY" },
		});
		await pasteAndSave(
			testing,
			view.getByLabelText("Value of STRIPE_KEY"),
			"sk-added-secret",
		);
	});
});
