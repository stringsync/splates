import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	typeAtCaret,
	waitFor,
	within,
} from "./testing";

describe("App's marked-up images", () => {
	let testing: Testing;
	let box: HTMLElement;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;
	let restore: () => void;

	beforeEach(async () => {
		testing = new Testing();
		// happy-dom decodes and draws nothing: stand-ins that keep what they are given.
		const decode = globalThis.createImageBitmap;
		const context = HTMLCanvasElement.prototype.getContext;
		const toBlob = HTMLCanvasElement.prototype.toBlob;
		const path = (globalThis as { Path2D?: unknown }).Path2D;
		globalThis.createImageBitmap = (async () => ({
			width: 100,
			height: 50,
			close() {},
		})) as unknown as typeof createImageBitmap;
		HTMLCanvasElement.prototype.getContext = (() =>
			new Proxy(
				{},
				{ get: () => () => {} },
			)) as unknown as typeof HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.toBlob = (done: BlobCallback) => {
			done(new Blob(["marked"], { type: "image/png" }));
		};
		(globalThis as { Path2D?: unknown }).Path2D = class {
			moveTo() {}
			lineTo() {}
			closePath() {}
			rect() {}
			arc() {}
		};
		restore = () => {
			globalThis.createImageBitmap = decode;
			HTMLCanvasElement.prototype.getContext = context;
			HTMLCanvasElement.prototype.toBlob = toBlob;
			(globalThis as { Path2D?: unknown }).Path2D = path;
		};
		view = await testing.openConversations([
			conversation({ id: "c1", title: "Look" }),
		]);
		box = view.getByRole("textbox", { name: "Message input" });
		await act(async () => box.focus());
		await act(async () =>
			fireEvent.paste(box, {
				clipboardData: {
					files: [new File(["png"], "two.png", { type: "image/png" })],
				},
			}),
		);
		await typeAtCaret(box, "see");
	});

	afterEach(() => {
		restore();
		testing.dispose();
		cleanup();
	});

	it("sends one image with its marks noted on it, not the original beside it, once it is marked up in the composer", async () => {
		const chip = await waitFor(() =>
			within(box).getByRole("button", { name: "Image 1" }),
		);
		await act(async () => fireEvent.click(chip));
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "Mark up" })),
		);
		const board = await waitFor(() =>
			view.getByRole("dialog", { name: "Mark up two.png" }),
		);
		const target = within(board).getByLabelText(/^two\.png, with/);
		target.setPointerCapture = () => {};
		target.getBoundingClientRect = () =>
			({ left: 0, top: 0, width: 100, height: 50 }) as DOMRect;
		await act(async () => {
			fireEvent.pointerDown(target, { clientX: 10, clientY: 10, button: 0 });
			fireEvent.pointerUp(target, { clientX: 10, clientY: 10, button: 0 });
		});
		await act(async () =>
			fireEvent.click(within(board).getByRole("button", { name: "close" })),
		);
		await waitFor(() =>
			expect(
				view.queryByRole("dialog", { name: "Mark up two.png" }),
			).toBeNull(),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(1),
		);
		const [sent] = testing.posted("/api/conversations/c1/prompt");
		expect(sent).toMatchObject({
			body: { text: "[Image 1] see\n\nMarks on [Image 1]:\n1. (no note)" },
		});
		expect((sent as { body: { file: File[] } }).body.file).toHaveLength(1);
	});

	it("leaves the composer untouched when thread image markup closes with no marks, and attaches it once marked", async () => {
		await testing.say(
			conversation({
				id: "c1",
				title: "Look",
				messages: [
					{
						...message("user", "earlier"),
						parts: [
							{ type: "image", name: "shot.png", mimeType: "image/png" },
							{ type: "text", text: "earlier" },
						],
					},
				],
			}),
		);
		const thread = view.getByRole("region", { name: "Look" });
		const sentChip = () =>
			within(
				thread.querySelector(".aui-user-message-content") as HTMLElement,
			).getByRole("button", { name: "Image 1" });
		await waitFor(() => expect(sentChip()).toBeTruthy());

		await act(async () => fireEvent.click(sentChip()));
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "View" })),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "shot.png" }),
		);
		await act(async () =>
			fireEvent.click(
				within(lightbox).getByRole("button", { name: "Mark up" }),
			),
		);
		const emptyBoard = await waitFor(() =>
			view.getByRole("dialog", { name: "Mark up shot.png" }),
		);
		await act(async () =>
			fireEvent.click(
				within(emptyBoard).getByRole("button", { name: "close" }),
			),
		);
		await waitFor(() =>
			expect(
				view.queryByRole("dialog", { name: "Mark up shot.png" }),
			).toBeNull(),
		);
		expect(textIn(box)).toBe("[Image 1] see");

		await act(async () => fireEvent.click(sentChip()));
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "Mark up" })),
		);
		const markedBoard = await waitFor(() =>
			view.getByRole("dialog", { name: "Mark up shot.png" }),
		);
		const target = within(markedBoard).getByLabelText(/^shot\.png, with/);
		target.setPointerCapture = () => {};
		target.getBoundingClientRect = () =>
			({ left: 0, top: 0, width: 100, height: 50 }) as DOMRect;
		await act(async () => {
			fireEvent.pointerDown(target, { clientX: 15, clientY: 15, button: 0 });
			fireEvent.pointerUp(target, { clientX: 15, clientY: 15, button: 0 });
		});
		await act(async () =>
			fireEvent.click(
				within(markedBoard).getByRole("button", { name: "Done" }),
			),
		);
		await waitFor(() => expect(textIn(box)).toBe("[Image 1] see [Image 2] "));

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(1),
		);
		const [sent] = testing.posted("/api/conversations/c1/prompt");
		expect(sent).toMatchObject({
			body: {
				text: "[Image 1] see [Image 2]\n\nMarks on [Image 2]:\n1. (no note)",
			},
		});
		expect((sent as { body: { file: File[] } }).body.file).toHaveLength(2);
	});
});
