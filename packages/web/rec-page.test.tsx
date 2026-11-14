import { afterEach, describe, expect, test } from "bun:test";
import { ConversationFeed } from "./conversation-feed";
import { Dispatch } from "./dispatch";
import { Dispatching } from "./dispatching";
import { Drafts, newDraft } from "./drafts";
import { RecPage } from "./rec-page";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";

const realFetch = globalThis.fetch;

describe("RecPage", () => {
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
		location.hash = "";
	});

	const serve = (
		lastOutcome: unknown,
		here = true,
		sources: unknown[] = [],
	) => {
		globalThis.fetch = (async (url: string) =>
			String(url).includes("creds")
				? Response.json({ kept: [] })
				: String(url).includes("rec/name")
					? Response.json({ name: "next-name" })
					: String(url).includes("rec/sessions")
						? Response.json({
								sessions: [
									{
										name: "brave-otter",
										startedAt: Date.now(),
										length: 30,
										size: 2_000_000,
										moments: 2,
									},
								],
								totalSize: 2_000_000,
								limit: 5_000_000_000,
								policy: "",
							})
						: Response.json({
								available: true,
								host: "studio",
								here,
								status: { running: false, lastOutcome },
								sources,
							})) as unknown as typeof fetch;
	};

	test("reviews the recording prompt and model settings before sending", async () => {
		location.hash = "rec/brave-otter";
		const requests: string[] = [];
		globalThis.fetch = (async (url: string) => {
			requests.push(String(url));
			return Response.json({
				name: "brave-otter",
				startedAt: 0,
				length: 30,
				size: 0,
				video: false,
				momentList: [],
				entries: [],
				stills: [],
				logs: [],
			});
		}) as typeof fetch;
		const feed = new ConversationFeed();
		const drafts = new Drafts();
		drafts.write(newDraft("shop"), "Keep my notes");
		const dispatch = new Dispatch(drafts, feed, "shop", [], [], []);
		const opened: string[] = [];
		const view = render(
			<Dispatching.Provider
				value={{ dispatch, open: (address) => opened.push(address) }}
			>
				<RecPage feed={feed} />
			</Dispatching.Provider>,
		);
		fireEvent.click(
			await view.findByRole("button", { name: "Send to an agent" }),
		);
		expect(opened).toEqual(["new/auto"]);
		expect(drafts.read(newDraft("shop"))).toContain("#rec:brave-otter");
		expect(drafts.read(newDraft("shop"))).toEndWith("Keep my notes");
		expect(requests.every((url) => !url.includes("conversations"))).toBe(true);
	});

	test("opens on the planner, with a History row and the Rec button", async () => {
		serve(undefined);
		const view = render(<RecPage />);

		const row = within(view.container).getByRole("link", { name: /^History/ });
		expect(row.getAttribute("href")).toBe("#rec/history");
		await waitFor(() => expect(row.textContent).toContain("1 session · "));
		expect(
			within(view.container).getByRole("button", { name: "Rec" }),
		).toBeTruthy();
	});

	test("one switch follows every container of a Compose project", async () => {
		serve(undefined, true, [
			{ kind: "docker", name: "api-web-1", project: "api" },
			{ kind: "docker", name: "api-db-1", project: "api" },
			{ kind: "docker", name: "lone" },
		]);
		const view = render(<RecPage />);
		const page = within(view.container);

		const group = await page.findByRole("switch", {
			name: "Follow every container in api",
		});
		expect(page.getByText("0 of 2 on")).toBeTruthy();
		fireEvent.click(group);

		await waitFor(() => expect(page.getByText("2 of 2 on")).toBeTruthy());
		expect(
			page
				.getByRole("switch", { name: "Follow api-db-1" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			page
				.getByRole("switch", { name: "Follow lone" })
				.getAttribute("aria-checked"),
		).toBe("false");
	});

	test("away from the server's machine, still shows the new rec form with a note", async () => {
		serve(undefined, false);
		const view = render(<RecPage />);

		await within(view.container).findByText(/Rec records on studio/);
		expect(
			within(view.container).getByRole("button", { name: "Rec" }),
		).toBeTruthy();
	});

	test("links the saved session by name", async () => {
		serve({ status: "saved", name: "brave-otter" });
		const view = render(<RecPage />);

		const link = await within(view.container).findByRole("link", {
			name: "brave-otter",
		});
		expect(link.getAttribute("href")).toBe("#rec/brave-otter");
	});

	test("copies the saved session's reference", async () => {
		serve({ status: "saved", name: "brave-otter" });
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		const view = render(<RecPage />);

		fireEvent.click(
			await within(view.container).findByRole("button", {
				name: "Copy reference",
			}),
		);

		await waitFor(() => expect(copied).toEqual(["#rec:brave-otter"]));
	});

	test("offers a new session name once one is saved", async () => {
		serve({ status: "saved", name: "brave-otter" });
		const view = render(<RecPage />);

		await waitFor(() =>
			expect(
				(
					within(view.container).getByLabelText(
						"Session name",
					) as HTMLInputElement
				).value,
			).toBe("next-name"),
		);
	});

	test("says why a recording was not saved", async () => {
		serve({ status: "failed", reason: "disk full" });
		const view = render(<RecPage />);

		await within(view.container).findByText("Not saved");
		expect(within(view.container).getByText("disk full")).toBeTruthy();
	});
	test("once rec exits unreported, drops the recording and links its saved session", async () => {
		let polls = 0;
		globalThis.fetch = (async (url: string) =>
			String(url).includes("creds")
				? Response.json({ kept: [] })
				: String(url).includes("rec/name")
					? Response.json({ name: "next-name" })
					: String(url).includes("rec/sessions")
						? Response.json({
								sessions: [
									{
										name: "brave-otter",
										startedAt: Date.now(),
										length: 30,
										size: 2_000_000,
										moments: 2,
									},
								],
								totalSize: 2_000_000,
								limit: 5_000_000_000,
								policy: "",
							})
						: Response.json({
								available: true,
								host: "studio",
								here: true,
								status:
									polls++ === 0
										? { running: true, name: "brave-otter", recording: true }
										: { running: false },
								sources: [],
							})) as unknown as typeof fetch;
		const view = render(<RecPage />);
		const page = within(view.container);

		await page.findByText(/Recording in Chrome/);
		const link = await page.findByRole(
			"link",
			{ name: "brave-otter" },
			{ timeout: 5000 },
		);
		expect(link.getAttribute("href")).toBe("#rec/brave-otter");
		expect(page.queryByText(/Recording in Chrome/)).toBeNull();
	}, 10_000);
});
