import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CredRequest } from "../creds";
import { REQUEST } from "./creds-testing";
import {
	act,
	cleanup,
	fireEvent,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's creds on a phone", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		resize(390, 844);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	// A phone has no tabs: its drawer opens the page by its address.
	const openCreds = async (creds: CredRequest[]) => {
		const view = await testing.open({ creds });
		await act(async () => {
			location.hash = "#creds";
			dispatchEvent(new HashChangeEvent("hashchange"));
		});
		return view;
	};

	it("puts a request's Dismiss beside Save, under the privacy line", async () => {
		const view = await openCreds([REQUEST]);

		const request = await waitFor(() =>
			view.getByRole("listitem", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		const save = within(request).getByRole("button", { name: "Save" });
		const dismiss = within(request).getByRole("button", { name: "Dismiss" });
		expect(save.parentElement).toBe(dismiss.parentElement);
		expect(save.previousElementSibling).toBe(dismiss);
		expect(
			within(request)
				.getByLabelText("Value of CLOUDFLARE_TOKEN")
				.parentElement?.contains(save),
		).toBe(false);
		await act(async () => fireEvent.click(dismiss));

		expect(testing.posted("/api/creds/CLOUDFLARE_TOKEN/dismiss")).toHaveLength(
			1,
		);
	});

	it("keeps a kept cred's actions in a menu, and removes one only once confirmed", async () => {
		testing.kept = {
			...testing.kept,
			kept: [{ name: "TUNNEL_TOKEN", scope: "device", savedBy: null }],
		};
		const view = await openCreds([]);

		const row = await waitFor(() =>
			view.getByRole("listitem", { name: "TUNNEL_TOKEN" }),
		);
		expect(within(row).queryByRole("button", { name: "Remove" })).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(row).getByRole("button", { name: "Actions on TUNNEL_TOKEN" }),
			),
		);
		const remove = await waitFor(() =>
			view.getByRole("menuitem", { name: "Remove" }),
		);
		await act(async () => fireEvent.click(remove));
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

	it("replaces a kept cred from its menu, with Cancel to put the field away", async () => {
		testing.kept = {
			...testing.kept,
			kept: [{ name: "DATABASE_URL", scope: "project", savedBy: null }],
		};
		const view = await openCreds([]);

		const row = await waitFor(() =>
			view.getByRole("listitem", { name: "DATABASE_URL" }),
		);
		await act(async () =>
			fireEvent.click(
				within(row).getByRole("button", { name: "Actions on DATABASE_URL" }),
			),
		);
		const replace = await waitFor(() =>
			view.getByRole("menuitem", { name: "Replace" }),
		);
		await act(async () => fireEvent.click(replace));
		expect(within(row).getByLabelText("Value of DATABASE_URL")).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(row).getByRole("button", { name: "Cancel" })),
		);

		expect(within(row).queryByLabelText("Value of DATABASE_URL")).toBeNull();
	});
});
