import { afterEach, describe, expect, test } from "bun:test";
import { Live } from "./rec-live";
import { RecPage } from "./rec-page";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";

const realFetch = globalThis.fetch;
const STATUS = { running: true, name: "brave-copper-otter" };

describe("Live", () => {
	afterEach(() => {
		cleanup();
		globalThis.fetch = realFetch;
	});

	test("Stop asks the server to close, then says it closed", async () => {
		const posted: string[] = [];
		globalThis.fetch = (async (url: string) => {
			posted.push(String(url));
			return new Response(null, { status: 204 });
		}) as unknown as typeof fetch;
		let closed = 0;
		const view = render(
			<Live status={STATUS} host="here" onClosed={() => closed++} />,
		);

		fireEvent.click(
			within(view.container).getByRole("button", { name: "Stop" }),
		);

		await waitFor(() => expect(closed).toBe(1));
		expect(posted).toEqual(["/api/rec/close"]);
	});

	test("a failed close shows why and leaves the button to try again", async () => {
		globalThis.fetch = (async () =>
			Response.json(
				{ reason: "no_rec", message: "no running rec was found to close" },
				{ status: 409 },
			)) as unknown as typeof fetch;
		let closed = 0;
		const view = render(
			<Live status={STATUS} host="here" onClosed={() => closed++} />,
		);

		fireEvent.click(
			within(view.container).getByRole("button", { name: "Stop" }),
		);

		await waitFor(() =>
			expect(within(view.container).getByText(/no running rec/)),
		);
		expect(closed).toBe(0);
		expect(
			within(view.container).getByRole("button", { name: "Stop" }),
		).toBeTruthy();
	});
});

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
});
