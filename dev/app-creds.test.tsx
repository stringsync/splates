import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CredRequest } from "../creds";
import {
	act,
	cleanup,
	fireEvent,
	Testing,
	tool,
	turn,
	waitFor,
	within,
} from "./testing";

const REQUEST: CredRequest = {
	name: "CLOUDFLARE_TOKEN",
	scope: "device",
	instructions: "Open **API Tokens** and create one.",
	task: "alpha",
	status: "open",
	requestedAt: "2026-10-14T12:00:00.000Z",
};

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

	it("shows a request with how to get it, and saves what is pasted", async () => {
		const view = await openCreds([REQUEST]);

		const request = await waitFor(() =>
			view.getByRole("listitem", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		expect(request.textContent).toContain("Open API Tokens and create one.");
		expect(request.textContent).toContain("this device");
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

	it("shows the request an agent said it made as a card in its thread, between its work", async () => {
		const view = await testing.openConversations(
			[
				turn([
					tool({ id: "x1", command: "arbor creds request CLOUDFLARE_TOKEN" }),
					"## 🔑 Requested CLOUDFLARE_TOKEN",
					tool({ id: "x2", command: "arbor creds wait CLOUDFLARE_TOKEN" }),
					"Saved, so I carry on.",
				]),
			],
			undefined,
			{ creds: [REQUEST] },
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		expect(card.textContent).toContain("Requested");
		expect(card.textContent).toContain("Open API Tokens and create one.");
		expect(view.container.textContent).not.toContain("## 🔑");
		fireEvent.change(within(card).getByLabelText("Value of CLOUDFLARE_TOKEN"), {
			target: { value: "cf-secret" },
		});
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Save" })),
		);

		expect(testing.posted("/api/creds/CLOUDFLARE_TOKEN")).toEqual([
			{ method: "PUT", body: { value: "cf-secret", scope: "device" } },
		]);
	});

	it("shows a filled request's card as saved", async () => {
		const view = await testing.openConversations(
			[turn(["## 🔑 Requested CLOUDFLARE_TOKEN"])],
			undefined,
			{ creds: [{ ...REQUEST, status: "saved" }] },
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		expect(card.textContent).toContain("Saved");
		expect(card.textContent).not.toContain("Open API Tokens");
	});
});
