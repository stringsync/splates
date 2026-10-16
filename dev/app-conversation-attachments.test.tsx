import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ConversationState } from "../conversations";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	typeAtCaret,
	typeIn,
	waitFor,
	within,
} from "./testing";

/** A part of a message as the server keeps it. */
type Part = ConversationState["messages"][number]["parts"][number];

describe("App's attachments", () => {
	let testing: Testing;
	/** Where each new tab the page opened was opened to. */
	let opened: (string | URL | undefined)[];
	let open: { mockRestore(): void };

	beforeEach(() => {
		testing = new Testing();
		opened = [];
		// A new tab is outside the page.
		// scry-ignore fakes-over-mocks
		open = spyOn(window, "open").mockImplementation((url) => {
			opened.push(url);
			return null;
		});
	});

	afterEach(() => {
		open.mockRestore();
		cleanup();
		testing.dispose();
	});

	/** The page open on a conversation whose one message says `text` and carries `files`. */
	const openSent = async (text: string, files: Part[]) => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", text),
						parts: [...files, { type: "text", text }],
					},
				],
			}),
		]);
		return { view, thread: view.getByRole("region", { name: "Look" }) };
	};

	/** The page open on a conversation with nothing said yet, and its composer. */
	const openEmpty = async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Look" }),
		]);
		return { view, box: view.getByRole("textbox", { name: "Message input" }) };
	};

	it("sends an image pasted into the composer, and shows the images the person sent on their message as chips", async () => {
		const { view, thread } = await openSent("this one", [
			{ type: "image", name: "ab12.png", mimeType: "image/png" },
		]);
		// In the message's box, ahead of its words, its chip and not the image.
		const chip = await waitFor(() =>
			within(thread).getByRole("button", { name: "Image 1" }),
		);
		expect(chip.closest(".aui-user-message-content")?.textContent).toBe(
			"Image 1this one",
		);
		expect(thread.querySelector("img")).toBeNull();
		await act(async () => fireEvent.click(chip));
		expect(view.getByRole("menuitem", { name: "Mark up" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "View" })),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "ab12.png" }),
		);
		expect(lightbox.querySelector("img")).not.toBeNull();
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "close" })),
		);
		const box = view.getByRole("textbox", { name: "Message input" });

		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await paste(box, [shot]);
		await typeIn(box, "and this");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "and this", file: [shot] } },
			]),
		);
	});

	it("attaches any file with ⌥⌘;, plays a recording the person sent, and opens any other file where it is kept", async () => {
		const { view, thread } = await openSent("these", [
			{
				type: "file",
				name: "ab12.mp4",
				title: "bug.mp4",
				mimeType: "video/mp4",
			},
			{
				type: "file",
				name: "cd34.pdf",
				title: "spec.pdf",
				mimeType: "application/pdf",
			},
		]);
		await viewFrom(
			await waitFor(() =>
				within(thread).getByRole("button", { name: "File 1" }),
			),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "bug.mp4" }),
		);
		expect(lightbox.querySelector("video")).not.toBeNull();
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "close" })),
		);
		await viewFrom(within(thread).getByRole("button", { name: "File 2" }));
		expect(String(opened[0])).toContain(
			"/api/conversations/c1/attachments/cd34.pdf",
		);

		const picked: HTMLInputElement[] = [];
		// The picker is an input outside the page, which no listener sees clicked.
		// scry-ignore fakes-over-mocks
		const click = spyOn(HTMLInputElement.prototype, "click").mockImplementation(
			function (this: HTMLInputElement) {
				picked.push(this);
			},
		);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				key: "…",
				code: "Semicolon",
				altKey: true,
				metaKey: true,
			}),
		);
		click.mockRestore();
		const input = picked[0];
		expect(input?.type).toBe("file");
		expect(input?.accept).toBe("");
		const clip = new File(["mp4 bytes"], "clip.mp4", { type: "video/mp4" });
		await act(async () => {
			Object.defineProperty(input, "files", { value: [clip] });
			input?.dispatchEvent(new Event("change"));
		});
		const box = view.getByRole("textbox", { name: "Message input" });
		await waitFor(() =>
			expect(within(box).getByRole("button", { name: "File 1" })).toBeTruthy(),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[File 1]", file: [clip] } },
			]),
		);
	});

	it("names each file attached in a chip at the caret, images apart from other files, renumbering the rest of its kind when one goes from its chip's menu", async () => {
		// scry-ignore simple-test-setup: these files are this test's own inputs, shared with no other
		const { view, box } = await openEmpty();
		const first = new File(["a"], "a.png", { type: "image/png" });
		const csv = new File(["x,y"], "notes.csv", { type: "text/csv" });
		const second = new File(["b"], "b.png", { type: "image/png" });
		const json = new File(["{}"], "data.json", { type: "application/json" });
		const third = new File(["c"], "c.png", { type: "image/png" });
		await typeIn(box, "compare");
		await paste(box, [first, csv, second, json, third]);

		await waitFor(() =>
			expect(textIn(box)).toBe(
				"compare [Image 1] [Image 2] [Image 3] [File 1] [File 2] ",
			),
		);
		const remove = async (chip: string) => {
			await act(async () =>
				fireEvent.click(within(box).getByRole("button", { name: chip })),
			);
			await act(async () =>
				fireEvent.click(
					await waitFor(() => view.getByRole("menuitem", { name: "Remove" })),
				),
			);
		};
		await waitFor(() =>
			expect(within(box).getByRole("button", { name: "File 1" })).toBeTruthy(),
		);
		await remove("File 1");
		await waitFor(() =>
			expect(textIn(box)).toBe(
				"compare [Image 1] [Image 2] [Image 3] [File 1] ",
			),
		);
		await remove("Image 1");

		await waitFor(() =>
			expect(textIn(box)).toBe("compare [Image 1] [Image 2] [File 1] "),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "compare [Image 1] [Image 2] [File 1]",
						file: [second, json, third],
					},
				},
			]),
		);
	});

	it("views an image attached from its chip's menu, and marks it up from there or from the lightbox", async () => {
		const { view, box } = await openEmpty();
		const shot = new File(["png bytes"], "shot.png", { type: "image/png" });
		await paste(box, [shot]);
		const chip = await waitFor(() =>
			within(box).getByRole("button", { name: "Image 1" }),
		);
		expect(
			view.container.querySelector(".aui-composer-attachments"),
		).toBeNull();

		await act(async () => fireEvent.click(chip));
		expect(view.getByRole("menuitem", { name: "Mark up" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "View" })),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "shot.png" }),
		);
		expect(lightbox.querySelector("img")).not.toBeNull();
		expect(
			within(lightbox).getByRole("button", { name: "Mark up" }),
		).toBeTruthy();
	});

	it("hints from an image's chip that ⌘B marks it up while the caret is just after it", async () => {
		const { box } = await openEmpty();
		await act(async () => box.focus());
		await paste(box, [new File(["png"], "one.png", { type: "image/png" })]);
		const shown = await waitFor(() => hint());
		expect(shown.textContent).toBe("Mark up ⌘B");

		// Words after it move the caret on; taking them back brings it home.
		await typeAtCaret(box, "x");
		await waitFor(() => expect(hintShown()).toBeNull());
		await typeAtCaret(box, "");
		await waitFor(() => expect(hint().textContent).toBe("Mark up ⌘B"));
	});

	it("marks up the image whose chip the caret is just after on ⌘B, and only there", async () => {
		const decode = globalThis.createImageBitmap;
		// The page decodes it to draw on, which happy-dom cannot.
		globalThis.createImageBitmap = (async () => ({
			width: 100,
			height: 50,
			close() {},
		})) as unknown as typeof createImageBitmap;
		try {
			const { view, box } = await openEmpty();
			await act(async () => box.focus());
			await paste(box, [new File(["png"], "two.png", { type: "image/png" })]);
			await typeAtCaret(box, "see");
			const commandB = { key: "b", code: "KeyB", metaKey: true };
			// Left to the page, where it does nothing.
			let left = false;
			await act(async () => {
				left = fireEvent.keyDown(box, commandB);
			});
			expect(left).toBe(true);
			expect(
				view.queryByRole("dialog", { name: "Mark up two.png" }),
			).toBeNull();

			await typeAtCaret(box, "");
			await typeAtCaret(box, "");
			await typeAtCaret(box, "");
			await waitFor(() => hint());
			await act(async () => fireEvent.keyDown(box, commandB));
			await waitFor(() =>
				expect(
					view.getByRole("dialog", { name: "Mark up two.png" }),
				).toBeTruthy(),
			);
			expect(textIn(box)).toBe("[Image 1] ");
		} finally {
			globalThis.createImageBitmap = decode;
		}
	});

	it("draws the images a sent message names as chips that view them", async () => {
		const { view, thread } = await openSent("see [Image 1]", [
			{ type: "image", name: "ab12.png", mimeType: "image/png" },
		]);

		await viewFrom(
			await waitFor(() =>
				within(thread).getByRole("button", { name: "Image 1" }),
			),
		);

		await waitFor(() =>
			expect(view.getByRole("dialog", { name: "ab12.png" })).toBeTruthy(),
		);
	});

	it("draws the other files a sent message names as chips that open them where they are kept", async () => {
		const { view, thread } = await openSent("see [File 1]", [
			{
				type: "file",
				name: "cd34.csv",
				title: "notes.csv",
				mimeType: "text/csv",
			},
		]);

		const chip = await waitFor(() =>
			within(thread).getByRole("button", { name: "File 1" }),
		);
		// Named where it stands, and not again in a row above the words.
		expect(
			within(thread).getAllByRole("button", { name: "File 1" }),
		).toHaveLength(1);
		expect(chip.getAttribute("title")).toBe("notes.csv");
		await act(async () => fireEvent.click(chip));
		expect(view.queryByRole("menuitem", { name: "Mark up" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "View" })),
		);

		expect(String(opened[0])).toContain(
			"/api/conversations/c1/attachments/cd34.csv",
		);
	});
});

/** Views the attachment `chip` names, from its menu. */
/** The hint a chip pops up, which only the eye reads. */
function hintShown(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');
}

function hint(): HTMLElement {
	const shown = hintShown();
	if (shown === null) {
		throw new Error("no hint is shown");
	}
	return shown;
}

async function viewFrom(chip: HTMLElement): Promise<void> {
	await act(async () => fireEvent.click(chip));
	await act(async () =>
		fireEvent.click(
			within(document.body).getByRole("menuitem", { name: "View" }),
		),
	);
}

/** Pastes `files` into the composer `box`. */
async function paste(box: HTMLElement, files: File[]): Promise<void> {
	await act(async () => fireEvent.paste(box, { clipboardData: { files } }));
}
