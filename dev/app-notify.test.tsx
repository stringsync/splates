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
			dialog: view.getByRole("dialog", { name: "Settings" }),
		};
	};

	it("opens from the header or with ⌘, listing settings by category", async () => {
		const { view, dialog } = await settings();
		expect(
			within(
				within(dialog).getByRole("navigation", { name: "setting categories" }),
			)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual([
			"Appearance",
			"Editor",
			"Notifications",
			"Restart",
			"Shortcuts",
		]);
		expect(within(dialog).getAllByRole("switch")).toHaveLength(6);

		await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Settings" })).toBeNull(),
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				key: ",",
				code: "Comma",
				metaKey: true,
			}),
		);
		expect(view.getByRole("dialog", { name: "Settings" })).toBeTruthy();
	});

	it("records a shortcut, taking it from the one that had it, and unsets one", async () => {
		const { view, dialog } = await settings();
		const field = (name: string) =>
			within(dialog).getByRole("button", { name: new RegExp(`^${name}: `) });
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
			key: "ç",
			code: "KeyC",
			altKey: true,
			metaKey: true,
		});
		expect(field("Search").getAttribute("aria-label")).toBe("Search: ⌥⌘C");
		expect(field("Checkpoint").getAttribute("aria-label")).toBe(
			"Checkpoint: none",
		);
		expect(within(dialog).getByText("Was Checkpoint's")).toBeTruthy();

		await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "Settings" })).toBeNull(),
		);
		await search({ key: "k", code: "KeyK", metaKey: true });
		expect(searching()).toBeNull();
		await search({ key: "ç", code: "KeyC", altKey: true, metaKey: true });
		await waitFor(() => expect(searching()).toBeTruthy());
		await search({ key: "ç", code: "KeyC", altKey: true, metaKey: true });
		await waitFor(() => expect(searching()).toBeNull());
		// Checkpoint lost its shortcut, so its menu item shows none.
		expect((await menuItem(view, "Checkpoint")).textContent).toBe("Checkpoint");

		await act(async () => fireEvent.keyDown(document.body, { key: "Escape" }));
		await act(async () =>
			fireEvent.keyDown(document.body, {
				key: ",",
				code: "Comma",
				metaKey: true,
			}),
		);
		const again = await waitFor(() =>
			view.getByRole("dialog", { name: "Settings" }),
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
				within(again).getByRole("button", { name: "Reset Checkpoint to ⌥⌘C" }),
			),
		);
		expect(
			within(again)
				.getByRole("button", { name: /^Checkpoint: / })
				.getAttribute("aria-label"),
		).toBe("Checkpoint: ⌥⌘C");
	});

	it("keeps only the settings a search matches, marking the words", async () => {
		const { dialog } = await settings();
		await act(async () =>
			fireEvent.change(within(dialog).getByRole("searchbox"), {
				target: { value: "sound" },
			}),
		);

		expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
		expect(dialog.querySelector("mark")?.textContent).toBe("sound");

		await act(async () =>
			fireEvent.change(within(dialog).getByRole("searchbox"), {
				target: { value: "zebra" },
			}),
		);
		expect(dialog.textContent).toContain("No settings match “zebra”");
	});

	it("picks the theme and accent among their choices, keeping them for the next visit", async () => {
		const { dialog } = await settings();
		const theme = within(dialog).getByRole("group", { name: "Theme" });
		expect(within(theme).getByRole("radio", { name: "System" })).toHaveProperty(
			"checked",
			true,
		);

		await act(async () =>
			fireEvent.click(within(theme).getByRole("radio", { name: "Dark" })),
		);
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("radio", { name: "Rose" })),
		);

		expect(within(theme).getByRole("radio", { name: "Dark" })).toHaveProperty(
			"checked",
			true,
		);
		expect(JSON.parse(localStorage.getItem("arbor.settings") ?? "")).toEqual({
			"appearance.theme": "dark",
			"appearance.accent": "rose",
		});
	});

	it("shows a switch under one that is off as off, keeping its own value for when it is on", async () => {
		localStorage.setItem(
			"arbor.settings",
			JSON.stringify({ "notifications.sound": true }),
		);
		const { dialog } = await settings();
		const sound = within(dialog).getByRole("switch", { name: "Play a sound" });
		expect(sound.getAttribute("aria-checked")).toBe("false");

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("switch", { name: "Notify me" }),
			),
		);

		await waitFor(() =>
			expect(sound.getAttribute("aria-checked")).toBe("true"),
		);
	});

	it("turns notifications on, then notifies of an agent that comes to wait, opening it on a click", async () => {
		const { view, runs, dialog } = await settings();
		const sound = within(dialog).getByRole("switch", { name: "Play a sound" });
		expect(sound.hasAttribute("data-disabled")).toBe(true);

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("switch", { name: "Notify me" }),
			),
		);
		await waitFor(() =>
			expect(sound.hasAttribute("data-disabled")).toBe(false),
		);
		await act(async () => fireEvent.keyDown(dialog, { key: "Escape" }));

		const away = spyOn(document, "hasFocus").mockReturnValue(false);
		await testing.say({ ...runs, status: "failed", error: "agent exited" });
		away.mockRestore();

		expect(FakeNotification.shown.map((each) => each.title)).toEqual([
			"Fix failed",
		]);
		await act(async () => FakeNotification.shown[0]?.onclick?.());
		expect(location.hash).toBe("#conversations/c1");
		expect(view.getByRole("tab", { name: /Conversations/ })).toBeTruthy();
	});
});
