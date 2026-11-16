import { afterEach, describe, expect, it, onTestFinished } from "bun:test";
import type { Cascade, CascadeStep, Stage } from "@splates/server/legacy-ship";
import "./register-dom";
import { StageRow } from "./legacy-ship-stages";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "./testing-library";

describe("StageRow release steps", () => {
	afterEach(cleanup);

	it("sends Yes for the question and disables both answers", async () => {
		const fetched = globalThis.fetch;
		const calls: unknown[] = [];
		globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
			calls.push(JSON.parse(String(init.body)));
			return Response.json({ ok: true });
		}) as typeof fetch;
		onTestFinished(() => {
			globalThis.fetch = fetched;
		});
		const view = render(
			<ol>
				<StageRow
					cascade={{ id: "c1", status: "running" } as Cascade}
					step={
						{
							slug: "demo",
							planned: true,
							status: "shipping",
							ship: "run1",
						} as CascadeStep
					}
					stage={{
						...command(
							[
								step("deploy", "asking", {
									ended: null,
									question: {
										questionId: "q1",
										question: "Deploy to production?",
									},
								}),
							],
							"asking",
						),
						key: "publish",
					}}
					ship={null}
					live
				/>{" "}
			</ol>,
		);
		expect(view.getByText("Deploy to production?")).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", {
					name: "Yes",
				}),
			),
		);
		expect(calls).toEqual([
			{
				id: "c1",
				project: "demo",
				started: "run1",
				questionId: "q1",
				answer: true,
			},
		]);
		expect(
			view.getByRole("button", { name: "Yes" }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			view.getByRole("button", { name: "No" }).hasAttribute("disabled"),
		).toBe(true);
	});
	it("sends No for the question and disables both answers", async () => {
		const fetched = globalThis.fetch;
		const calls: unknown[] = [];
		globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
			calls.push(JSON.parse(String(init.body)));
			return Response.json({ ok: true });
		}) as typeof fetch;
		onTestFinished(() => {
			globalThis.fetch = fetched;
		});
		const view = render(
			<ol>
				<StageRow
					cascade={{ id: "c1", status: "running" } as Cascade}
					step={
						{
							slug: "demo",
							planned: true,
							status: "shipping",
							ship: "run1",
						} as CascadeStep
					}
					stage={{
						...command(
							[
								step("deploy", "asking", {
									ended: null,
									question: {
										questionId: "q1",
										question: "Deploy to production?",
									},
								}),
							],
							"asking",
						),
						key: "publish",
					}}
					ship={null}
					live
				/>{" "}
			</ol>,
		);
		expect(view.getByText("Deploy to production?")).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", {
					name: "No",
				}),
			),
		);
		expect(calls).toEqual([
			{
				id: "c1",
				project: "demo",
				started: "run1",
				questionId: "q1",
				answer: false,
			},
		]);
		expect(
			view.getByRole("button", { name: "Yes" }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			view.getByRole("button", { name: "No" }).hasAttribute("disabled"),
		).toBe(true);
	});
	it("shows planned script steps without requiring the Publish wrapper to be opened", () => {
		const stage = {
			...command([step("deploy", "failed", { error: "deployment rejected" })]),
			key: "publish" as const,
		};
		const view = render(
			<ol>
				<StageRow
					cascade={{ id: "c1" } as Cascade}
					step={{ slug: "stage", planned: true } as CascadeStep}
					stage={stage}
					ship={null}
					live={false}
				/>
			</ol>,
		);
		expect(view.getByRole("list", { name: "Release steps" })).toBeTruthy();
		expect(view.getByText("deployment rejected")).toBeTruthy();
		expect(view.queryByRole("button", { name: /Ship command/ })).toBeNull();
	});

	it("lists a project's release steps under its stage once opened", async () => {
		const view = show(
			command([
				step("a", "done"),
				step("b", "failed", { error: "tsc broke" }),
				step("c", "pending", { started: null, ended: null }),
				step("d", "skipped"),
			]),
		);
		expect(view.queryByRole("list", { name: "Release steps" })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Ship command/ })),
		);
		const list = view.getByRole("list", { name: "Release steps" });
		expect(within(list).getAllByRole("listitem")).toHaveLength(4);
		expect(within(list).getByText("tsc broke")).toBeTruthy();
		expect(within(list).getByText("already done")).toBeTruthy();
	});

	it("links a release step to the publish run it waits on", () => {
		const view = show(
			command(
				[
					step("a", "running", {
						status: "in_progress",
						url: "https://github.com/o/r/actions/runs/1",
					}),
				],
				"running",
			),
			true,
		);
		const link = view.getByRole("link", { name: "run on GitHub" });
		expect(link.getAttribute("href")).toBe(
			"https://github.com/o/r/actions/runs/1",
		);
		expect(view.getByText("in_progress")).toBeTruthy();
	});

	it("opens a failed release step to what it printed, and folds what came outside every step", async () => {
		const asked: string[] = [];
		stubLogs(asked);
		const view = show(
			command([
				step("a", "done", { log: { from: 0, to: 4 } }),
				step("b", "failed", { error: "tsc broke", log: { from: 4, to: 9 } }),
			]),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Ship command/ })),
		);
		await waitFor(() => expect(view.getByText("log of b")).toBeTruthy());
		expect(view.queryByText("log of a")).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("listitem", { name: "A" })).getByRole("button"),
			),
		);
		await waitFor(() => expect(view.getByText("log of a")).toBeTruthy());
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Other output" })),
		);
		await waitFor(() => expect(view.getByText("log of ~outside")).toBeTruthy());
		expect(asked).toEqual(["b", "a", "~outside"]);
	});

	it("shows the command alone when its project reports no steps", () => {
		const view = show(command());
		expect(view.queryByRole("list", { name: "Release steps" })).toBeNull();
		expect(view.getByText("Ship command")).toBeTruthy();
	});
});

function step(id: string, state: string, extra = {}) {
	return {
		id,
		name: id.toUpperCase(),
		stage: "build",
		packages: [],
		state,
		started: "2026-10-30T12:00:00.000Z",
		ended: state === "running" ? null : "2026-10-30T12:00:05.000Z",
		deadlineMs: 60_000,
		checked: null,
		status: null,
		url: null,
		error: null,
		...extra,
	};
}

/** Answers each release step's log as "log of <id>", noting which were asked for. */
function stubLogs(asked: string[]) {
	const fetched = globalThis.fetch;
	globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
		const release = new URL(String(input), "http://localhost").searchParams.get(
			"release",
		);
		asked.push(release ?? "");
		return new Response(`log of ${release}`);
	}) as typeof fetch;
	onTestFinished(() => {
		globalThis.fetch = fetched;
	});
}

function command(releaseSteps?: unknown[], state = "done"): Stage {
	return {
		key: "command",
		name: "Ship command",
		state,
		started: "2026-10-30T12:00:00.000Z",
		ended: state === "running" ? null : "2026-10-30T12:01:00.000Z",
		expected: 1000,
		known: false,
		deadline: null,
		check: null,
		log: null,
		releaseSteps,
	} as unknown as Stage;
}

function show(stage: Stage, live = false) {
	return render(
		<ol>
			<StageRow
				cascade={{ id: "c1" } as Cascade}
				step={{ slug: "demo" } as CascadeStep}
				stage={stage}
				ship={null}
				live={live}
			/>
		</ol>,
	);
}
