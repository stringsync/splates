import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	menuItem,
	Testing,
	waitFor,
	within,
} from "./testing";

/** A browser that lets the page notify, keeping what it showed. */
class FakeNotification {
	static permission: NotificationPermission = "default";
	static shown: FakeNotification[] = [];
	static requestPermission = async () => {
		FakeNotification.permission = "granted";
		return FakeNotification.permission;
	};
	onclick: (() => void) | null = null;
	constructor(readonly title: string) {
		FakeNotification.shown.push(this);
	}
	close(): void {}
}

describe("App's settings and notifications", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		Object.assign(FakeNotification, { permission: "default", shown: [] });
		Object.assign(globalThis, { Notification: FakeNotification });
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		Reflect.deleteProperty(globalThis, "Notification");
	});

	/** Opens the page holding one running conversation, and its settings. */
	const settings = async () => {
		const runs = conversation({ id: "c1", title: "Fix", status: "running" });
		testing.talk = {
			agents: [{ id: "claude", name: "Claude", settings: [], limits: [] }],
			conversations: [runs],
		};
		const view = await testing.open({ tasks: [details({ task: "alpha" })] });
		await act(async () => fireEvent.click(await menuItem(view, "Settings")));
		return {
			view,
			runs,
			panel: view.getByRole("region", { name: "Settings" }),
		};
	};

	/** Shows one category's page. */
	const page = async (dialog: HTMLElement, category: string) =>
		act(async () =>
			fireEvent.click(
				within(
					within(dialog).getByRole("navigation", {
						name: "setting categories",
					}),
				).getByRole("button", { name: category }),
			),
		);

	it("opens from the header or with ⌘, showing one category at a time, the one picked kept", async () => {
		const { view, panel } = await settings();
		expect(
			within(
				within(panel).getByRole("navigation", { name: "setting categories" }),
			)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual([
			"Appearance",
			"Startup",
			"Editor",
			"Notifications",
			"Agents",
			"Updates",
			"Shortcuts",
			"Canned replies",
		]);
		expect(within(panel).getByRole("group", { name: "Theme" })).toBeTruthy();

		await page(panel, "Notifications");
		expect(within(panel).queryByRole("group", { name: "Theme" })).toBeNull();
		expect(within(panel).getAllByRole("switch")).toHaveLength(6);

		await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
		await waitFor(() =>
			expect(view.queryByRole("region", { name: "Settings" })).toBeNull(),
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				key: ",",
				code: "Comma",
				metaKey: true,
			}),
		);
		const reopened = view.getByRole("region", { name: "Settings" });
		expect(within(reopened).getAllByRole("switch").length).toBeGreaterThan(0);
		expect(within(reopened).queryByRole("group", { name: "Theme" })).toBeNull();
	});

	it("records a shortcut, taking it from the one that had it, and unsets one", async () => {
		const { view, panel } = await settings();
		await page(panel, "Shortcuts");
		const field = (name: string) =>
			within(panel).getByRole("button", { name: new RegExp(`^${name}: `) });
		const record = async (name: string, keys: KeyboardEventInit) => {
			await act(async () => fireEvent.click(field(name)));
			expect(field(name).getAttribute("aria-label")).toBe(
				`${name}: press a shortcut`,
			);
			await act(async () => fireEvent.keyDown(field(name), keys));
		};
		const search = (keys: KeyboardEventInit) =>
			act(async () => fireEvent.keyDown(window, keys));
		const searching = () => view.queryByRole("textbox", { name: "search" });

		// Only modifiers, or a key with none of ⌘, ⌃ or ⌥, records nothing yet.
		await record("Search", { key: "Meta", code: "MetaLeft", metaKey: true });
		await act(async () =>
			fireEvent.keyDown(field("Search"), { key: "j", code: "KeyJ" }),
		);
		expect(field("Search").getAttribute("aria-label")).toBe(
			"Search: press a shortcut",
		);
		await act(async () =>
			fireEvent.keyDown(field("Search"), {
				key: "j",
				code: "KeyJ",
				metaKey: true,
			}),
		);
		expect(field("Search").getAttribute("aria-label")).toBe("Search: ⌘J");

		await record("Fullscreen", {
			key: "∆",
			code: "KeyJ",
			altKey: true,
			metaKey: true,
		});
		await record("Search", {
			key: "∆",
			code: "KeyJ",
			altKey: true,
			metaKey: true,
		});
		expect(field("Search").getAttribute("aria-label")).toBe("Search: ⌥⌘J");
		expect(field("Fullscreen").getAttribute("aria-label")).toBe(
			"Fullscreen: none",
		);
		expect(within(panel).getByText("Was Fullscreen's")).toBeTruthy();

		await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
		await waitFor(() =>
			expect(view.queryByRole("region", { name: "Settings" })).toBeNull(),
		);
		await search({ key: "k", code: "KeyK", metaKey: true });
		expect(searching()).toBeNull();
		await search({ key: "∆", code: "KeyJ", altKey: true, metaKey: true });
		await waitFor(() => expect(searching()).toBeTruthy());
		await search({ key: "∆", code: "KeyJ", altKey: true, metaKey: true });
		await waitFor(() => expect(searching()).toBeNull());
		await act(async () =>
			fireEvent.keyDown(document.body, {
				key: ",",
				code: "Comma",
				metaKey: true,
			}),
		);
		const again = await waitFor(() =>
			view.getByRole("region", { name: "Settings" }),
		);
		await act(async () =>
			fireEvent.click(
				within(again).getByRole("button", { name: "Unset Search" }),
			),
		);
		expect(
			within(again)
				.getByRole("button", { name: /^Search: / })
				.getAttribute("aria-label"),
		).toBe("Search: none");
		await act(async () =>
			fireEvent.click(
				within(again).getByRole("button", { name: "Reset Fullscreen to ⌥⌘F" }),
			),
		);
		expect(
			within(again)
				.getByRole("button", { name: /^Fullscreen: / })
				.getAttribute("aria-label"),
		).toBe("Fullscreen: ⌥⌘F");
	});

	it("keeps only the settings a search matches, marking the words", async () => {
		const { panel } = await settings();
		await act(async () =>
			fireEvent.change(within(panel).getByRole("searchbox"), {
				target: { value: "sound" },
			}),
		);

		expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
		expect(panel.querySelector("mark")?.textContent).toBe("sound");

		await act(async () =>
			fireEvent.change(within(panel).getByRole("searchbox"), {
				target: { value: "zebra" },
			}),
		);
		expect(panel.textContent).toContain("No settings match “zebra”");
	});

	it("picks the theme among its choices, keeping them for the next visit", async () => {
		const { panel } = await settings();
		const theme = within(panel).getByRole("group", { name: "Theme" });
		expect(within(theme).getByRole("radio", { name: "System" })).toHaveProperty(
			"checked",
			true,
		);

		await act(async () =>
			fireEvent.click(within(theme).getByRole("radio", { name: "Dark" })),
		);

		expect(within(theme).getByRole("radio", { name: "Dark" })).toHaveProperty(
			"checked",
			true,
		);
		expect(JSON.parse(localStorage.getItem("splates.settings") ?? "")).toEqual({
			"appearance.theme": "dark",
			"startup.welcome": false,
		});
	});

	it("shows a switch under one that is off as off, keeping its own value for when it is on", async () => {
		localStorage.setItem(
			"splates.settings",
			JSON.stringify({ "notifications.sound": true }),
		);
		const { panel } = await settings();
		await page(panel, "Notifications");
		const sound = within(panel).getByRole("switch", { name: "Play a sound" });
		expect(sound.getAttribute("aria-checked")).toBe("false");

		await act(async () =>
			fireEvent.click(within(panel).getByRole("switch", { name: "Notify me" })),
		);

		await waitFor(() =>
			expect(sound.getAttribute("aria-checked")).toBe("true"),
		);
	});

	it("turns notifications on, then notifies of an agent that comes to wait, opening it on a click", async () => {
		const { view, runs, panel } = await settings();
		await page(panel, "Notifications");
		const sound = within(panel).getByRole("switch", { name: "Play a sound" });
		expect(sound.hasAttribute("data-disabled")).toBe(true);

		await act(async () =>
			fireEvent.click(within(panel).getByRole("switch", { name: "Notify me" })),
		);
		await waitFor(() =>
			expect(sound.hasAttribute("data-disabled")).toBe(false),
		);
		await act(async () => fireEvent.keyDown(window, { key: "Escape" }));

		// vet-ignore fakes-over-mocks: jsdom has no document focus to fake; the file already spied before this task
		const away = spyOn(document, "hasFocus").mockReturnValue(false);
		await testing.say({ ...runs, status: "failed", error: "agent exited" });
		away.mockRestore();

		expect(FakeNotification.shown.map((each) => each.title)).toEqual(["Fix"]);
		await act(async () => FakeNotification.shown[0]?.onclick?.());
		expect(location.hash).toBe("#conversations/c1");
		expect(view.getByRole("region", { name: "Fix" })).toBeTruthy();
	});
});
