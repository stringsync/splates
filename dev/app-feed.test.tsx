import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	snapshot,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's feed", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("refetches when the server says something moved", async () => {
		const view = await testing.open();

		testing.served = snapshot({
			todos: [todo({ subject: "new one" })],
		});
		await act(async () => testing.stream?.onmessage?.());

		await waitFor(() => expect(view.getByText(/new one/)).toBeTruthy());
	});

	it("says it is offline when the server goes away", async () => {
		const view = await testing.open();
		expect(view.queryByText(/Offline/)).toBeNull();

		testing.goAway();
		await act(async () => testing.stream?.onmessage?.());

		await waitFor(() => expect(view.getByText(/Offline/)).toBeTruthy());
	});

	it("says it is outdated, with what to run, when a newer arbor moved the records on", async () => {
		const view = await testing.open();

		testing.refuse(
			"outdated",
			"written by a newer arbor\nRun `bunx @webappwiz/arbor@latest` instead.",
		);
		await act(async () => testing.stream?.onmessage?.());

		const badge = await waitFor(() => view.getByText("Outdated"));
		expect(badge.textContent).toBe("Outdated");
		expect(badge.title).toContain("bunx @webappwiz/arbor@latest");
		expect(view.queryByText(/Offline/)).toBeNull();
	});

	it("offers a newer arbor, opening Checkpoint with restart and resume picked", async () => {
		testing.projects = [
			{
				slug: "shop",
				root: "/code/shop",
				gone: false,
				here: true,
				conversations: [
					{
						id: "c1",
						name: "Fix checkout",
						status: "running",
						checkpoint: null,
					},
				],
				waiting: 0,
			},
		];
		const view = await testing.open();
		expect(view.queryByText("Restart to update")).toBeNull();

		testing.served = snapshot({
			release: { running: "0.0.43", newest: "0.0.44" },
		});
		await act(async () => testing.stream?.onmessage?.());
		const badge = await waitFor(() =>
			view.getByRole("button", { name: "Restart to update" }),
		);
		expect(badge.title).toBe("arbor 0.0.44 is out (this runs 0.0.43)");
		await act(async () => badge.click());

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Checkpoint" }),
		);
		expect(
			(
				within(dialog).getByRole("radio", {
					name: /^Checkpoint, restart and resume/,
				}) as HTMLInputElement
			).checked,
		).toBe(true);
		await act(async () =>
			within(dialog).getByRole("button", { name: "Proceed" }).click(),
		);
		expect(
			testing.posts
				.filter((each) => each.path === "/api/checkpoint")
				.map((each) => JSON.parse(String(each.body))),
		).toEqual([{ projects: ["shop"], after: "resume" }]);
	});

	it("offers a restart once commits land on the source it runs from", async () => {
		const view = await testing.open();
		expect(view.queryByText("Restart to update")).toBeNull();

		testing.served = snapshot({
			behind: { running: "a".repeat(40), newest: "b".repeat(40) },
		});
		await act(async () => testing.stream?.onmessage?.());
		const badge = await waitFor(() =>
			view.getByRole("button", { name: "Restart to update" }),
		);
		expect(badge.title).toBe(
			"arbor's source is at bbbbbbbb (this runs aaaaaaaa)",
		);
		await act(async () => badge.click());

		await waitFor(() => view.getByRole("dialog", { name: "Checkpoint" }));
	});

	it("grays out the tab's icon while offline, and brings it back", async () => {
		const icon = document.createElement("link");
		icon.rel = "icon";
		icon.href = "data:image/svg+xml,tree";
		document.head.append(icon);
		const view = await testing.open();

		testing.goAway();
		await act(async () => testing.stream?.onmessage?.());
		await waitFor(() => expect(icon.href).toContain("saturate"));

		view.unmount();
		expect(icon.href).toBe("data:image/svg+xml,tree");
		icon.remove();
	});
});
