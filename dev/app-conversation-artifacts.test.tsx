import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Artifact, ArtifactVersion } from "../artifacts";
import type { Event } from "../events";
import {
	act,
	cleanup,
	fireEvent,
	resize,
	second,
	Testing,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's artifacts", () => {
	let testing: Testing;
	/** Each link the page followed, as its address and the name it downloads under. */
	let followed: { href: string; download: string }[];
	let click: { mockRestore(): void };

	beforeEach(() => {
		testing = new Testing();
		followed = [];
		// A download leaves the page.
		// scry-ignore fakes-over-mocks
		click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			function (this: HTMLAnchorElement) {
				followed.push({ href: this.href, download: this.download });
			},
		);
	});

	afterEach(() => {
		click.mockRestore();
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	/** The page open on conversation c1 keeping `artifacts`, after `events`. */
	const opened = async (artifacts: Artifact[], events: Event[] = []) => {
		const view = await testing.openConversations([
			{ ...turn(["Done."]), artifacts, events },
		]);
		return {
			view,
			thread: await waitFor(() => view.getByRole("region", { name: "Tests" })),
		};
	};

	it("draws an add and a remove as the artifact, opening the version it names", async () => {
		const { thread } = await opened(
			[artifact("report.html", [version(1), version(2)])],
			[
				added(1, "report.html", 1),
				added(2, "report.html", 2),
				removed(3, "report.html", 2),
				{ ...added(4, "big.png", 1), reason: "too_large" },
			],
		);

		const lines = await waitFor(() => {
			const found = within(thread).getAllByRole("note", { name: "arbor" });
			expect(found).toHaveLength(3);
			return found;
		});
		expect(lines.map((line) => line.textContent)).toEqual([
			"Addedreport.html",
			"Addedreport.html(v2)",
			"Removedreport.html",
		]);
		await act(async () =>
			fireEvent.click(
				within(lines[1] as HTMLElement).getByRole("button", {
					name: "report.html",
				}),
			),
		);
		expect(followed).toEqual([
			{
				href: expect.stringContaining(
					"/api/conversations/c1/artifacts/report.html/2",
				),
				download: "report.html",
			},
		]);
	});

	it("lists the artifacts it keeps beside the thread, each opening its current version", async () => {
		const { view } = await opened([
			artifact("report.html", [version(1, 300), version(2, 4096)]),
			artifact("shot.png", [version(1, 3 * 1024 * 1024)]),
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		const listed = within(card).getByRole("list", { name: "listed artifacts" });
		expect(
			within(listed)
				.getAllByRole("listitem")
				.map((row) => row.textContent),
		).toEqual(["report.htmlv2 · 4 KBDelete", "shot.png3.0 MBDelete"]);
		await act(async () =>
			fireEvent.click(
				within(listed).getByRole("button", { name: "report.html v2" }),
			),
		);
		expect(followed.map((each) => each.href)).toEqual([
			expect.stringContaining("/artifacts/report.html/2"),
		]);
	});

	it("keeps removed artifacts and replaced versions behind a Removed row, a gone one a placeholder", async () => {
		const { view } = await opened([
			artifact("report.html", [
				{ ...version(1, 300), gone: { at: second(5), why: "evicted" } },
				version(2, 500),
			]),
			{ ...artifact("old.png", [version(1, 2048)]), removedAt: second(6) },
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		expect(
			within(card).queryByRole("list", { name: "removed artifacts" }),
		).toBe(null);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Removed 2" })),
		);
		const hidden = within(card).getByRole("list", {
			name: "removed artifacts",
		});
		expect(
			within(hidden)
				.getAllByRole("listitem")
				.map((row) => row.textContent?.replace(/\d+\w ago/, "ago")),
		).toEqual([
			"report.htmlevicted for space agov1 · 300 B",
			"old.pngv1 · 2 KBDelete",
		]);
		// The gone one has nothing to open; the removed one still opens.
		const [gone] = within(hidden).getAllByRole("listitem");
		expect(within(gone as HTMLElement).queryByRole("button")).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(hidden).getByRole("button", { name: "old.png v1" }),
			),
		);
		expect(followed.map((each) => each.href)).toEqual([
			expect.stringContaining("/artifacts/old.png/1"),
		]);
		// The same row collapses them again.
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Removed 2" })),
		);
		expect(
			within(card).queryByRole("list", { name: "removed artifacts" }),
		).toBeNull();
	});

	it("deletes a version's bytes after a confirm on its row, and not a gone one", async () => {
		const { view } = await opened([
			artifact("report.html", [
				{ ...version(1, 300), gone: { at: second(5), why: "evicted" } },
				version(2, 500),
			]),
		]);
		const card = view.getByRole("region", { name: "artifacts" });
		expect(
			within(card).queryByRole("button", { name: /Delete .*v1/ }),
		).toBeNull();

		const button = within(card).getByRole("button", {
			name: "Delete report.html v2",
		});
		await act(async () => fireEvent.click(button));
		expect(
			testing.posted("/api/conversations/c1/artifacts/report.html/2"),
		).toEqual([]);
		expect(button.textContent).toBe("Delete?");
		await act(async () => fireEvent.click(button));
		await waitFor(() => expect(button.textContent).toBe("Deleted"));
		expect(
			testing.posted("/api/conversations/c1/artifacts/report.html/2"),
		).toEqual([{ method: "DELETE", body: {} }]);
	});

	it("opens a page in a sandboxed frame that may run scripts and nothing more", async () => {
		const { view } = await opened([
			artifact("report.html", [
				version(1, 10, "text/html"),
				version(2, 10, "text/html"),
			]),
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: "report.html v2" }),
			),
		);
		const viewer = await waitFor(() =>
			view.getByRole("dialog", { name: "report.html v2" }),
		);
		const frame = within(viewer).getByTitle("report.html v2");
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
		expect(frame.getAttribute("src")).toContain(
			"/api/conversations/c1/artifacts/report.html/2",
		);
		expect(followed).toEqual([]);
		await act(async () =>
			fireEvent.click(within(viewer).getByRole("button", { name: "close" })),
		);
		await waitFor(() =>
			expect(view.queryByRole("dialog", { name: "report.html v2" })).toBeNull(),
		);
	});

	it("opens an image or a recording in the lightbox among the others beside it, and downloads anything else", async () => {
		const { view } = await opened([
			artifact("a.png", [version(1, 10, "image/png")]),
			artifact("notes.pdf", [version(1, 10, "application/pdf")]),
			artifact("run.mp4", [version(1, 10, "video/mp4")]),
			artifact("page.html", [version(1, 10, "text/html")]),
			{
				...artifact("old.png", [version(1, 10, "image/png")]),
				removedAt: second(9),
			},
		]);

		const card = view.getByRole("region", { name: "artifacts" });
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "run.mp4" })),
		);
		const lightbox = await waitFor(() =>
			view.getByRole("dialog", { name: "run.mp4" }),
		);
		expect(lightbox.querySelector("video")?.getAttribute("src")).toContain(
			"/artifacts/run.mp4/1",
		);
		// The listed images and recordings, the removed one apart.
		expect(within(lightbox).getByText("2 of 2")).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(lightbox).getByRole("button", { name: "next" })),
		);
		await waitFor(() => view.getByRole("dialog", { name: "a.png" }));
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "close" })),
		);

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "notes.pdf" })),
		);
		expect(followed).toEqual([
			{
				href: expect.stringContaining("/artifacts/notes.pdf/1"),
				download: "notes.pdf",
			},
		]);

		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "Removed 1" })),
		);
		await act(async () =>
			fireEvent.click(within(card).getByRole("button", { name: "old.png v1" })),
		);
		const removed = await waitFor(() =>
			view.getByRole("dialog", { name: "old.png v1" }),
		);
		expect(within(removed).queryByText(/of \d/)).toBeNull();
	});

	it("opens an artifact's chip in a line in its viewer", async () => {
		const { thread } = await opened(
			[artifact("shot.png", [version(1, 10, "image/png")])],
			[added(1, "shot.png", 1)],
		);
		const line = await waitFor(() =>
			within(thread).getByRole("note", { name: "arbor" }),
		);
		await act(async () =>
			fireEvent.click(within(line).getByRole("button", { name: "shot.png" })),
		);
		await waitFor(() =>
			within(document.body).getByRole("dialog", { name: "shot.png" }),
		);
		expect(followed).toEqual([]);
	});

	it("shows no card while it keeps no artifacts", async () => {
		const { view } = await opened([]);
		expect(view.queryByRole("region", { name: "artifacts" })).toBeNull();
	});

	it("opens the artifacts on a phone from the widgets in its header", async () => {
		resize(390, 844);
		const { view } = await opened([artifact("shot.png", [version(1, 10)])]);
		const widgets = view.getByRole("region", { name: "widgets" });
		expect(widgets.inert).toBe(true);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Widgets" })),
		);
		expect(widgets.inert).toBe(false);
		await act(async () =>
			fireEvent.click(
				within(widgets).getByRole("button", { name: "shot.png" }),
			),
		);
		expect(followed.map((each) => each.download)).toEqual(["shot.png"]);
	});
});

/** An artifact listed at the last of `versions`. */
function artifact(name: string, versions: ArtifactVersion[]): Artifact {
	return {
		name,
		current: versions.length,
		versions,
		removedAt: null,
	};
}

/** Version `number` of an artifact, `bytes` long of `mimeType`, its bytes kept. */
function version(
	number: number,
	bytes = 100,
	mimeType = "application/octet-stream",
): ArtifactVersion {
	return {
		version: number,
		file: `id${number}`,
		mimeType,
		bytes,
		addedAt: second(number),
		gone: null,
	};
}

/** An `arbor artifact add` at `secs` that made `version` of `name`. */
function added(secs: number, name: string, version: number): Event {
	return {
		id: `add${secs}`,
		at: second(secs),
		action: "artifact add",
		task: "alpha",
		reason: null,
		conversation: "c1",
		name,
		version,
		bytes: 100,
	};
}

/** An `arbor artifact remove` at `secs` of `name`, current at `version`. */
function removed(secs: number, name: string, version: number): Event {
	return {
		id: `remove${secs}`,
		at: second(secs),
		action: "artifact remove",
		task: "alpha",
		reason: null,
		conversation: "c1",
		name,
		version,
	};
}
