import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	menuItem,
	OFFLINE_AFTER,
	resize,
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

	it("waits out a blip, as a tunnel reconnecting, before saying it is offline", async () => {
		const view = await testing.open();

		testing.goAway();
		await act(async () => testing.stream?.onerror?.());
		await Bun.sleep(OFFLINE_AFTER.ms / 2);
		expect(view.queryByText(/Offline/)).toBeNull();
		testing.comeBack();
		await act(async () => testing.stream?.onopen?.());
		await Bun.sleep(OFFLINE_AFTER.ms);

		expect(view.queryByText(/Offline/)).toBeNull();
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

	it("says the build failed when the page it serves is the one built before", async () => {
		const view = await testing.open();
		expect(view.queryByText("Build failed")).toBeNull();

		testing.served = snapshot({ unbuilt: true });
		await act(async () => testing.stream?.onmessage?.());

		const badge = await waitFor(() => view.getByText("Build failed"));
		expect(badge.title).toContain("the terminal running arbor dev says why");
	});

	it("keeps Power in the sidebar, offering a newer arbor on it, and restarting from it", async () => {
		testing.projects = [
			{
				slug: "shop",
				root: "/code/shop",
				gone: false,
				focused: true,
				conversations: [
					{
						id: "c1",
						name: "Fix checkout",
						status: "running",
						checkpoint: null,
						survives: false,
					},
				],
				waiting: 0,
			},
		];
		const view = await testing.open();
		expect(view.queryByText("Restart to update")).toBeNull();
		expect((await menuItem(view, "Power")).textContent).toContain("Power");

		testing.served = snapshot({
			release: { running: "0.0.43", newest: "0.0.44" },
		});
		await act(async () => testing.stream?.onmessage?.());
		const badge = await menuItem(view, "Power: restart to update");
		expect(badge.title).toBe("arbor 0.0.44 is out (this runs 0.0.43)");
		await act(async () => badge.click());

		const dialog = await waitFor(() =>
			view.getByRole("dialog", { name: "Power" }),
		);
		await act(async () =>
			within(dialog)
				.getByRole("button", { name: /^Restart/ })
				.click(),
		);
		expect(
			testing.posts
				.filter((each) => each.path === "/api/power")
				.map((each) => JSON.parse(String(each.body))),
		).toEqual([{ shutdown: false }]);
	});

	it("offers a restart once commits land on the source it runs from", async () => {
		const view = await testing.open();
		expect(view.queryByText("Restart to update")).toBeNull();

		testing.served = snapshot({
			behind: { running: "a".repeat(40), newest: "b".repeat(40) },
		});
		await act(async () => testing.stream?.onmessage?.());
		const badge = await menuItem(view, "Power: restart to update");
		expect(badge.title).toBe(
			"arbor's source is at bbbbbbbb (this runs aaaaaaaa)",
		);
		await act(async () => badge.click());

		await waitFor(() => view.getByRole("dialog", { name: "Power" }));
	});

	it("keeps Reload, Power and Settings in a phone's bar, in its kebab", async () => {
		try {
			resize(390, 844);
			const view = await testing.open();
			const more = view.getByRole("button", { name: "More" });
			expect(more.querySelector(".bg-warning")).toBeNull();
			await act(async () => fireEvent.click(more));
			await waitFor(() => view.getByRole("menuitem", { name: "Settings" }));
			// An installed app has no browser's reload button, so the menu holds one.
			view.getByRole("menuitem", { name: "Reload page" });
			await act(async () =>
				fireEvent.click(view.getByRole("menuitem", { name: "Power" })),
			);
			await waitFor(() => view.getByRole("dialog", { name: "Power" }));
		} finally {
			// Unmounted first, so going wide again redraws nothing.
			cleanup();
			resize(1024, 768);
		}
	});

	it("puts Update before a phone's kebab, and dots the Power in it, once a restart would update", async () => {
		try {
			resize(390, 844);
			const view = await testing.open();
			expect(
				view.queryByRole("button", { name: "Restart to update" }),
			).toBeNull();
			testing.served = snapshot({
				release: { running: "0.0.43", newest: "0.0.44" },
			});
			await act(async () => testing.stream?.onmessage?.());
			const update = await waitFor(() =>
				view.getByRole("button", { name: "Restart to update" }),
			);
			expect(update.textContent).toBe("Update");
			const more = view.getByRole("button", { name: "More" });
			expect(more.querySelector(".bg-warning")).toBeNull();
			await act(async () => fireEvent.click(more));
			const restart = await waitFor(() =>
				view.getByRole("menuitem", { name: "Power: restart to update" }),
			);
			expect(restart.title).toBe("arbor 0.0.44 is out (this runs 0.0.43)");
			expect(restart.querySelector(".bg-warning")).not.toBeNull();
		} finally {
			// Unmounted first, so going wide again redraws nothing.
			cleanup();
			resize(1024, 768);
		}
	});

	it("opens Power from Restart to update, beside the kebab", async () => {
		const view = await testing.open();
		expect(
			view.queryByRole("button", { name: "Restart to update" }),
		).toBeNull();

		testing.served = snapshot({
			behind: { running: "a".repeat(40), newest: "b".repeat(40) },
		});
		await act(async () => testing.stream?.onmessage?.());
		const restart = await waitFor(() =>
			view.getByRole("button", { name: "Restart to update" }),
		);
		expect(restart.textContent).toBe("Restart to update");
		expect(
			restart.parentElement?.nextElementSibling?.getAttribute("aria-label"),
		).toBe("More");
		await act(async () => fireEvent.click(restart));

		await waitFor(() => view.getByRole("dialog", { name: "Power" }));
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
