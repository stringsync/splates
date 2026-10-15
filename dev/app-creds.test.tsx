import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CredRequest } from "../creds";
import {
	act,
	cleanup,
	fireEvent,
	resize,
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

	it("says on a request's card that the value stays private, and opens how", async () => {
		const view = await testing.openConversations(
			[turn(["## 🔑 Requested CLOUDFLARE_TOKEN"])],
			undefined,
			{ creds: [REQUEST] },
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		expect(card.textContent).toContain(
			"Private: the agent never sees it, and it is kept encrypted.",
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Learn more" })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(
			within(dialog).getByRole("heading", { name: "How creds stay private" }),
		).toBeTruthy();
		expect(
			within(dialog)
				.getAllByRole("term")
				.map((each) => each.textContent),
		).toEqual([
			"The agent never sees it",
			"It is in no conversation or log",
			"It is never saved in plain text",
			"Only code reads it",
		]);
	});

	it("keeps a value pasted on a request's card to its store alone", async () => {
		const view = await testing.openConversations(
			[turn(["## 🔑 Requested CLOUDFLARE_TOKEN"])],
			undefined,
			{ creds: [REQUEST] },
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "requested CLOUDFLARE_TOKEN" }),
		);
		await pasteAndSave(
			testing,
			within(card).getByLabelText("Value of CLOUDFLARE_TOKEN"),
			"cf-card-secret",
		);
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

/**
 * Pastes `value` into `field` and saves it, then checks it went nowhere but
 * the one write to its store: a hidden field, emptied or gone once saved, with the
 * value in no other write, no storage and nothing on the page. Each field
 * says the value stays private.
 */
async function pasteAndSave(
	testing: Testing,
	field: HTMLElement,
	value: string,
): Promise<void> {
	const input = field as HTMLInputElement;
	expect(input.type).toBe("password");
	expect(input.autocomplete).toBe("off");
	const form = input.closest("form");
	if (form === null) {
		throw new Error("the field is in no form");
	}
	expect(form.textContent).toContain(
		"Private: the agent never sees it, and it is kept encrypted. Learn more",
	);
	fireEvent.change(input, { target: { value } });
	await act(async () => fireEvent.submit(form));

	await waitFor(() => expect(input.isConnected ? input.value : "").toBe(""));
	const carrying = testing.posts.filter((each) =>
		JSON.stringify(each.body ?? "").includes(value),
	);
	expect(carrying.map((each) => [each.method, each.path])).toEqual([
		["PUT", expect.stringMatching(/^\/api\/creds\/[A-Z_]+$/)],
	]);
	expect(JSON.stringify({ ...localStorage })).not.toContain(value);
	expect(JSON.stringify({ ...sessionStorage })).not.toContain(value);
	expect(document.body.innerHTML).not.toContain(value);
}
