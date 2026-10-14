import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	textIn,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's attachments", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("sends an image pasted into the composer, and shows the images the person sent on their message", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "this one"),
						parts: [
							{ type: "image", name: "ab12.png", mimeType: "image/png" },
							{ type: "text", text: "this one" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });
		// In the message's box, ahead of its words, as the composer holds it.
		await waitFor(() =>
			expect(
				within(thread)
					.getByRole("button", { name: "Preview ab12.png" })
					.closest(".aui-user-message-content")
					?.textContent?.endsWith("this one"),
			).toBe(true),
		);
		await act(async () =>
			fireEvent.click(
				within(thread).getByRole("button", { name: "Preview ab12.png" }),
			),
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
		await act(async () =>
			fireEvent.paste(box, { clipboardData: { files: [shot] } }),
		);
		await typeIn(box, "and this");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "and this", file: [shot] } },
			]),
		);
	});

	it("attaches any file with ⌥⌘;, plays a recording the person sent, and links any other file", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "these"),
						parts: [
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
							{ type: "text", text: "these" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					within(thread).getByRole("button", { name: "Preview bug.mp4" }),
				),
			),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "bug.mp4" }),
		);
		expect(lightbox.querySelector("video")).not.toBeNull();
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "close" })),
		);
		expect(
			within(thread)
				.getByRole("link", { name: "spec.pdf" })
				.getAttribute("href"),
		).toContain("/api/conversations/c1/attachments/cd34.pdf");

		const picked: HTMLInputElement[] = [];
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
			expect(
				view.getByRole("button", { name: "Preview clip.mp4" }),
			).toBeTruthy(),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[File 1]", file: [clip] } },
			]),
		);
	});

	it("names each file attached, on its tile and in a chip at the caret, images apart from other files, renumbering the rest of its kind when one goes", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Look" }),
		]);
		const box = view.getByRole("textbox", { name: "Message input" });
		const png = (name: string) => new File([name], name, { type: "image/png" });
		const [first, csv, second, json, third] = [
			png("a.png"),
			new File(["x,y"], "notes.csv", { type: "text/csv" }),
			png("b.png"),
			new File(["{}"], "data.json", { type: "application/json" }),
			png("c.png"),
		];
		await typeIn(box, "compare");
		for (const file of [first, csv, second, json, third]) {
			await act(async () =>
				fireEvent.paste(box, { clipboardData: { files: [file] } }),
			);
		}

		await waitFor(() =>
			expect(textIn(box)).toBe(
				"compare [Image 1] [File 1] [Image 2] [File 2] [Image 3] ",
			),
		);
		const tiles = view.container.ownerDocument.querySelector(
			".aui-composer-attachments",
		) as HTMLElement;
		const names = () =>
			[...tiles.querySelectorAll("[data-attachment]")].map((tile) =>
				tile.getAttribute("data-attachment"),
			);
		expect(names()).toEqual([
			"Image 1",
			"File 1",
			"Image 2",
			"File 2",
			"Image 3",
		]);

		await act(async () =>
			fireEvent.click(
				within(tiles).getByRole("button", { name: "Remove notes.csv" }),
			),
		);
		await waitFor(() =>
			expect(names()).toEqual(["Image 1", "Image 2", "File 1", "Image 3"]),
		);
		expect(textIn(box)).toBe("compare [Image 1] [Image 2] [File 1] [Image 3] ");
		await act(async () =>
			fireEvent.click(
				within(tiles).getByRole("button", { name: "Remove a.png" }),
			),
		);

		await waitFor(() =>
			expect(textIn(box)).toBe("compare [Image 1] [File 1] [Image 2] "),
		);
		await waitFor(() =>
			expect(names()).toEqual(["Image 1", "File 1", "Image 2"]),
		);
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "compare [Image 1] [File 1] [Image 2]",
						file: [second, json, third],
					},
				},
			]),
		);
	});

	it("draws the images a sent message names as chips that open them", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "see [Image 1]"),
						parts: [
							{ type: "image", name: "ab12.png", mimeType: "image/png" },
							{ type: "text", text: "see [Image 1]" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });

		const chip = await waitFor(() =>
			within(thread).getByRole("button", { name: "Image 1" }),
		);
		await act(async () => fireEvent.click(chip));

		await waitFor(() =>
			expect(view.getByRole("dialog", { name: "ab12.png" })).toBeTruthy(),
		);
	});

	it("draws the other files a sent message names as chips on the tiles they open", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Look",
				messages: [
					{
						...message("user", "see [File 1]"),
						parts: [
							{
								type: "file",
								name: "cd34.csv",
								title: "notes.csv",
								mimeType: "text/csv",
							},
							{ type: "text", text: "see [File 1]" },
						],
					},
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Look" });

		const chip = await waitFor(() =>
			within(thread).getByRole("button", { name: "File 1" }),
		);
		const tile = thread.querySelector('[data-attachment="File 1"]');
		expect(tile?.textContent).toBe("notes.csv");
		const opened = mock();
		tile?.addEventListener("click", (event) => {
			event.preventDefault();
			opened();
		});
		await act(async () => fireEvent.click(chip));

		expect(opened).toHaveBeenCalledTimes(1);
	});
});
