import { describe, expect, test } from "bun:test";
import type { RecState, RecStatus } from "@splates/server/rec/browser";
import { FakeTimer } from "core/time/testing";
import {
	type PlanRecordApi,
	PlanRecordController,
} from "./plan-record-controller";

describe("PlanRecordController", () => {
	test("Stop shows stopping until rec has saved", async () => {
		const timer = new FakeTimer();
		const { api, setStatus } = rec();
		const controller = await recording(api, timer);

		await controller.stop();
		expect(controller.phase).toEqual({ at: "stopping", name: "brave-otter" });

		setStatus({ running: false, processing: ["brave-otter"] });
		timer.fireIntervals();
		await settle();
		expect(controller.phase).toEqual({ at: "stopping", name: "brave-otter" });

		setStatus({
			running: false,
			processing: [],
			lastOutcome: { status: "saved", name: "brave-otter" },
		});
		timer.fireIntervals();
		await settle();
		expect(controller.phase).toEqual({ at: "saved", name: "brave-otter" });
		expect(controller.take()).toBe("#rec:brave-otter");
		expect(controller.phase).toEqual({ at: "idle" });
	});

	test("a failed stop request goes back to recording", async () => {
		const timer = new FakeTimer();
		const { api } = rec(async () => {
			throw new Error("offline");
		});
		const controller = await recording(api, timer);

		await controller.stop();
		expect(controller.phase).toEqual({ at: "recording", name: "brave-otter" });
	});

	test("shows stopping when Chrome closes while rec processes", async () => {
		const timer = new FakeTimer();
		const { api, setStatus } = rec();
		const controller = await recording(api, timer);

		setStatus({ running: false, processing: ["brave-otter"] });
		timer.fireIntervals();
		await settle();
		expect(controller.phase).toEqual({ at: "stopping", name: "brave-otter" });
	});

	test("a failed save shows the failure", async () => {
		const timer = new FakeTimer();
		const { api, setStatus } = rec();
		const controller = await recording(api, timer);

		await controller.stop();
		setStatus({
			running: false,
			lastOutcome: { status: "failed", reason: "no audio" },
		});
		timer.fireIntervals();
		await settle();
		expect(controller.phase).toEqual({ at: "failed", reason: "no audio" });
		expect(timer.intervals.every((entry) => entry.disposed)).toBe(true);
	});
});

function settle(): Promise<unknown> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function rec(close: () => Promise<void> = async () => {}) {
	let status: RecStatus = { running: true };
	const api: PlanRecordApi = {
		state: async (): Promise<RecState> => ({
			available: true,
			host: "localhost",
			status,
			sources: [],
		}),
		name: async () => "brave-otter",
		open: async () => {},
		close,
	};
	return {
		api,
		setStatus: (next: RecStatus) => {
			status = next;
		},
	};
}

async function recording(api: PlanRecordApi, timer: FakeTimer) {
	const controller = new PlanRecordController(api, timer);
	await controller.start("http://localhost/plan.html");
	expect(controller.phase).toEqual({ at: "recording", name: "brave-otter" });
	return controller;
}
