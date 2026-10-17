import { describe, expect, it } from "bun:test";
import { heldKey, label, matches, NONE, recorded, valid } from "./shortcuts";
import "./testing";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("shortcuts", () => {
	it("presses ⌘ or Ctrl for Mod, both for Ctrl with Mod, and only Ctrl for Ctrl alone", () => {
		expect(
			matches(
				press({ code: "KeyC", altKey: true, metaKey: true }),
				"Alt+Mod+KeyC",
			),
		).toBe(true);
		expect(
			matches(
				press({ code: "KeyC", altKey: true, ctrlKey: true }),
				"Alt+Mod+KeyC",
			),
		).toBe(true);
		expect(
			matches(press({ code: "KeyC", metaKey: true }), "Alt+Mod+KeyC"),
		).toBe(false);
		expect(
			matches(
				press({ code: "KeyC", altKey: true, shiftKey: true, metaKey: true }),
				"Alt+Mod+KeyC",
			),
		).toBe(false);

		expect(
			matches(
				press({ code: "KeyP", ctrlKey: true, metaKey: true }),
				"Ctrl+Mod+KeyP",
			),
		).toBe(true);
		expect(
			matches(press({ code: "KeyP", metaKey: true }), "Ctrl+Mod+KeyP"),
		).toBe(false);

		expect(
			matches(press({ code: "Backquote", ctrlKey: true }), "Ctrl+Backquote"),
		).toBe(true);
		expect(
			matches(press({ code: "Backquote", metaKey: true }), "Ctrl+Backquote"),
		).toBe(false);

		expect(matches(press({ code: "KeyK", metaKey: true }), NONE)).toBe(false);
	});

	it("records ⌘ as Mod, and Ctrl as Mod off a Mac but as itself on one", () => {
		expect(recorded(press({ code: "KeyK", metaKey: true }), true)).toBe(
			"Mod+KeyK",
		);
		expect(recorded(press({ code: "KeyK", ctrlKey: true }), true)).toBe(
			"Ctrl+KeyK",
		);
		expect(recorded(press({ code: "KeyK", ctrlKey: true }), false)).toBe(
			"Mod+KeyK",
		);
		expect(
			recorded(press({ code: "KeyP", ctrlKey: true, metaKey: true }), true),
		).toBe("Ctrl+Mod+KeyP");
		expect(
			recorded(
				press({ code: "KeyC", altKey: true, shiftKey: true, metaKey: true }),
				true,
			),
		).toBe("Alt+Shift+Mod+KeyC");
		expect(
			recorded(press({ code: "MetaLeft", metaKey: true }), true),
		).toBeNull();
	});

	it("holds only a key with ⌃, ⌥ or ⌘, in its one order", () => {
		expect(valid(NONE)).toBe(true);
		expect(valid("Alt+Mod+KeyC")).toBe(true);
		expect(valid("Ctrl+Backquote")).toBe(true);
		expect(valid("KeyC")).toBe(false);
		expect(valid("Shift+KeyC")).toBe(false);
		expect(valid("Mod+Alt+KeyC")).toBe(false);
		expect(valid("Hyper+KeyC")).toBe(false);
		expect(valid("Mod+ShiftLeft")).toBe(false);
	});

	it("reads as a Mac prints it, and shows its key alone only for ⌥⌘", () => {
		expect(label("Alt+Mod+KeyC")).toBe("⌥⌘C");
		expect(label("Ctrl+Mod+KeyP")).toBe("⌃⌘P");
		expect(label("Alt+Mod+Backspace")).toBe("⌥⌘⌫");
		expect(label("Mod+Comma")).toBe("⌘,");
		expect(label(NONE)).toBe("");

		expect(heldKey("Alt+Mod+BracketRight")).toBe("]");
		expect(heldKey("Alt+Shift+Mod+KeyT")).toBeNull();
		expect(heldKey("Mod+KeyK")).toBeNull();
		expect(heldKey(NONE)).toBeNull();
	});
});
