import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

const ANTHROPIC = {
	id: "anthropic",
	name: "Anthropic",
	env: "ANTHROPIC_API_KEY",
	agents: ["claude"],
	keys: "https://platform.claude.com/settings/keys",
	limits: "https://platform.claude.com/settings/workspaces",
	scope: "workspace",
	proxy: {
		upstream: "https://api.anthropic.com",
		header: "x-api-key",
		base: "ANTHROPIC_BASE_URL",
	},
};

const HELD = {
	provider: "anthropic",
	holder: { worker: "box" },
	cred: "SPLATES_ANTHROPIC_KEY_WORKER_BOX",
	addedAt: "2026-10-17T10:00:00.000Z",
};

describe("App's worker keys", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.workerKeys = {
			keys: [HELD],
			providers: [ANTHROPIC],
			holders: { workers: ["box"], types: ["small"] },
		};
		testing.kept = {
			...testing.kept,
			kept: [
				{ name: HELD.cred, scope: "device", savedBy: null },
				{ name: "OTHER_TOKEN", scope: "project", savedBy: null },
			],
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const openCreds = async () => {
		const view = await testing.open({ creds: [] });
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Creds/ })),
		);
		return view;
	};

	it("lists each worker's key by whose it is, and not again among the kept creds", async () => {
		const view = await openCreds();

		const keys = await waitFor(() =>
			view.getByRole("region", { name: "worker keys" }),
		);
		await waitFor(() =>
			within(keys).getByRole("listitem", {
				name: "Anthropic key for worker box",
			}),
		);
		await waitFor(() => view.getByRole("listitem", { name: "OTHER_TOKEN" }));
		expect(view.queryByRole("listitem", { name: HELD.cred })).toBeNull();
	});

	it("adds a key for a type, saying where to make it and set its limit", async () => {
		const view = await openCreds();
		const keys = await waitFor(() =>
			view.getByRole("region", { name: "worker keys" }),
		);
		await waitFor(() =>
			expect(
				(
					within(keys).getByRole("button", {
						name: "Add key",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false),
		);
		await act(async () =>
			fireEvent.click(within(keys).getByRole("button", { name: "Add key" })),
		);
		fireEvent.change(within(keys).getByLabelText("Held by"), {
			target: { value: "type:small" },
		});

		expect(
			within(keys)
				.getAllByRole("link")
				.map((each) => each.getAttribute("href")),
		).toEqual([ANTHROPIC.limits, ANTHROPIC.keys]);
		const field = within(keys).getByLabelText("Value of Anthropic key");
		fireEvent.change(field, { target: { value: "sk-ant-new" } });
		await act(async () =>
			fireEvent.submit(field.closest("form") as HTMLElement),
		);

		expect(testing.posted("/api/workers/keys")).toEqual([
			{
				method: "PUT",
				body: { provider: "anthropic", type: "small", value: "sk-ant-new" },
			},
		]);
	});

	it("removes a key once asked twice, telling the person to revoke it", async () => {
		const view = await openCreds();
		const row = await waitFor(() =>
			view.getByRole("listitem", { name: "Anthropic key for worker box" }),
		);

		await act(async () =>
			fireEvent.click(within(row).getByRole("button", { name: "Remove" })),
		);
		expect(row.textContent).toContain("Revoke it in Anthropic's console too");
		await act(async () =>
			fireEvent.click(
				within(row).getByRole("button", {
					name: "Remove Anthropic key for worker box",
				}),
			),
		);

		expect(
			testing.posts.map((each) => [each.method, each.path]),
		).toContainEqual([
			"DELETE",
			"/api/workers/keys?provider=anthropic&worker=box",
		]);
	});
});
