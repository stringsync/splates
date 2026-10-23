import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

describe("App's billing runners", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		const up = new Date(Date.now() - (2 * 60 + 14) * 60_000).toISOString();
		testing.runnersReport = {
			updated: new Date().toISOString(),
			images: [{ id: "1", gigabytes: 4.5, dollarsPerMonth: 0.27 }],
			runners: [
				{
					id: "c-16-up",
					type: "c-16",
					size: { cpus: 16, memory: 32 },
					provider: "digitalocean",
					dollarsPerHour: 0.5,
					stoppedDollarsPerHour: null,
					state: "running",
					from: up,
					until: null,
					hours: (2 * 60 + 14) / 60,
					stoppedHours: 0,
					dollars: 1.1,
					jobs: 3,
				},
				{
					id: "fly-kept",
					type: "shared-cpu-4x-8gb",
					size: { cpus: 4, memory: 8 },
					provider: "fly",
					dollarsPerHour: 0.07,
					stoppedDollarsPerHour: 0.3 / 730,
					state: "stopped",
					from: "2026-10-14T10:00:00.000Z",
					until: null,
					hours: 1,
					stoppedHours: 7 * 24,
					dollars: 0.07 + (7 * 24 * 0.3) / 730,
					jobs: 2,
				},
				{
					id: "c-16-old",
					type: "c-16",
					size: null,
					provider: "digitalocean",
					dollarsPerHour: 0.5,
					stoppedDollarsPerHour: null,
					state: "destroyed",
					from: "2026-09-30T10:00:00.000Z",
					until: "2026-09-30T14:00:00.000Z",
					hours: 4,
					stoppedHours: 0,
					dollars: 2,
					jobs: 7,
				},
			],
			days: [
				{ period: "2026-10-21", hours: 4, dollars: 2 },
				{ period: "2026-10-22", hours: 2, dollars: 1 },
			],
			months: [
				{ period: "2026-09-01", hours: 4, dollars: 2, billed: 3, gap: -33.3 },
				{ period: "2026-10-01", hours: 6, dollars: 3, billed: null, gap: null },
			],
			split: {
				days: [
					{
						period: "2026-10-21",
						shares: [
							{
								project: "/Users/me/app",
								task: "fix-login",
								dollars: 1.5,
								slotHours: 0.5,
								estimate: true,
							},
							{
								project: null,
								task: null,
								dollars: 0.5,
								slotHours: 0,
								estimate: true,
							},
						],
					},
				],
				months: [],
			},
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const open = async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("runner list"));
		return view;
	};

	it("lists each runner by its size, or its type where the ledger kept none, with what it cost, one up now with its time and Delete", async () => {
		const view = await open();
		const up = view.getByLabelText("c-16-up");
		const old = view.getByLabelText("c-16-old");

		expect(up.textContent).toContain("16 CPUs, 32 GB, $0.50/h");
		expect(up.textContent).toContain("running now");
		expect(up.textContent).toContain("2h 14m running");
		expect(up.textContent).toContain("3 jobs");
		expect(old.textContent).toContain("c-16");
		expect(old.textContent).toContain("7 jobs · $0.50/h");
		expect(old.textContent).toContain("Deleted");
		expect(old.textContent).toContain("$2.00");
		expect(within(old).queryByRole("button", { name: /Delete/ })).toBeNull();

		testing.holdWrites();
		await act(async () =>
			fireEvent.click(within(up).getByRole("button", { name: /Delete/ })),
		);
		expect(up.textContent).toContain("Deleting…");
		expect(
			testing.posts
				.filter(({ path }) => path.startsWith("/api/workers"))
				.map(({ path, method }) => [path, method]),
		).toEqual([["/api/workers/c-16-up", "DELETE"]]);
	});

	it("lists a stopped runner kept, with its stopped time and what its disk costs", async () => {
		const view = await open();
		const kept = view.getByLabelText("fly-kept");

		expect(kept.textContent).toContain("stopped, kept at $0.30/month");
		expect(kept.textContent).toContain("1h 0m running");
		expect(kept.textContent).toContain("7d 0h stopped");
		expect(kept.textContent).toContain("$0.139");
	});

	it("lists the runner image with its size and monthly cost", async () => {
		const view = await open();
		const image = view.getByLabelText("runner images");

		expect(image.textContent).toContain("4.5 GB");
		expect(image.textContent).toContain("$0.27/month");
	});

	it("lists the newest eight runners until asked for all", async () => {
		const [first] = testing.runnersReport.runners;
		testing.runnersReport.runners = Array.from({ length: 10 }, (_, at) => ({
			...(first as NonNullable<typeof first>),
			id: `c-16-${at}`,
			until: "2026-10-22T12:00:00.000Z",
		}));
		const view = await open();

		expect(
			within(view.getByLabelText("runner list")).getAllByRole("listitem"),
		).toHaveLength(8);
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Show all 10 runners" }),
			),
		);
		expect(
			within(view.getByLabelText("runner list")).getAllByRole("listitem"),
		).toHaveLength(10);
	});

	it("sets each month's estimate beside its bill, amber when far off", async () => {
		const view = await open();
		const table = view.getByLabelText("estimate beside the bill");

		expect(table.textContent).toContain("not billed yet");
		const gap = within(table).getByText("-33%");
		expect(gap.className).toContain("text-warning");
	});

	it("shows who a picked day's cost went to", async () => {
		const view = await open();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /^Oct 21:/ })),
		);
		const split = view.getByLabelText("by task");
		expect(split.textContent).toContain("fix-login");
		expect(split.textContent).toContain("app · 30m of jobs");
		expect(split.textContent).toContain("Idle");

		fireEvent.click(view.getByRole("button", { name: "Months" }));
		expect(view.getByText("Per month")).toBeTruthy();
	});
});
