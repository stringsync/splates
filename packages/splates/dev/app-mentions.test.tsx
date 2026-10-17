import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor } from "./testing";

describe("App's @ files", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("offers the repo's files for an @, best match first, and writes the one picked", async () => {
		const { view, box } = await todoBox(testing, [
			"src/",
			"src/app.tsx",
			"src/lib/",
			"src/lib/apply.ts",
			"README.md",
		]);

		await type(box, "see @app");

		const options = await waitFor(() => view.getAllByRole("option"));
		expect(options.map((option) => option.textContent)).toEqual([
			"app.tsxsrc/",
			"apply.tssrc/lib/",
		]);
		await act(async () => fireEvent.keyDown(box, { key: "ArrowDown" }));
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(box.value).toBe("see @src/lib/apply.ts ");
		expect(view.queryByRole("listbox")).toBeNull();
		// Enter picked a file; it did not add the todo.
		expect(testing.posts).toEqual([]);
	});

	it("keeps the list open inside a directory picked", async () => {
		const { view, box } = await todoBox(testing, [
			"src/",
			"src/lib/",
			"src/lib/a.ts",
		]);

		await type(box, "@sr");
		await act(async () =>
			fireEvent.mouseDown(view.getByRole("option", { name: /^src\// })),
		);
		expect(box.value).toBe("@src/");
		await type(box, box.value);

		expect(
			view.getAllByRole("option").map((option) => option.textContent),
		).toEqual(["lib/src/", "a.tssrc/lib/"]);
	});

	it("closes the list on Escape, leaving the text as typed", async () => {
		const { view, box } = await todoBox(testing, ["src/app.tsx"]);

		await type(box, "@app");
		await waitFor(() => view.getByRole("listbox"));
		await act(async () => fireEvent.keyDown(box, { key: "Escape" }));

		expect(view.queryByRole("listbox")).toBeNull();
		expect(box.value).toBe("@app");
	});

	it("ignores an @ inside a word, like an address", async () => {
		const { view, box } = await todoBox(testing, ["example.com"]);

		await type(box, "mail me@example");

		expect(view.queryByRole("listbox")).toBeNull();
	});
});

/** The page open on the new todo's box, with `paths` as the repo's files. */
async function todoBox(testing: Testing, paths: string[]) {
	testing.tree = paths;
	const view = await testing.open();
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Add a todo" })),
	);
	const box = view.getByRole("textbox", {
		name: "new todo",
	}) as HTMLInputElement;
	return { view, box };
}

/** Types `value` as if the caret ended up at its end. */
async function type(box: HTMLInputElement, value: string) {
	await act(async () => {
		box.focus();
		fireEvent.change(box, { target: { value } });
		box.setSelectionRange(value.length, value.length);
		fireEvent.select(box);
	});
}
