import { describe, expect, it } from "bun:test";
import { budgetedWorkers, memoryWorkers } from "./worker-memory";

describe("worker memory", () => {
	it("takes a share of free memory at the cost of a worker, never below one", () => {
		expect(memoryWorkers(32_000, 0.25, 600)).toBe(13);
		expect(memoryWorkers(32_000, 0.5, 600)).toBe(26);
		expect(memoryWorkers(1_000, 0.25, 600)).toBe(1);
		expect(memoryWorkers(0, 0.25, 600)).toBe(1);
	});

	it("keeps the cores when memory allows them", () => {
		expect(
			budgetedWorkers({
				cores: 8,
				half: "server",
				gate: false,
				freeMb: 64_000,
			}),
		).toEqual({ workers: 8, byMemory: false });
	});

	it("lets free memory set the count when it allows fewer", () => {
		expect(
			budgetedWorkers({ cores: 8, half: "server", gate: false, freeMb: 6_000 }),
		).toEqual({ workers: 2, byMemory: true });
	});

	it("lets a gate take more than an agent's run, and a page worker costs less", () => {
		expect(
			budgetedWorkers({ cores: 14, half: "server", gate: true, freeMb: 6_000 }),
		).toEqual({ workers: 5, byMemory: true });
		expect(
			budgetedWorkers({ cores: 14, half: "page", gate: false, freeMb: 6_000 }),
		).toEqual({ workers: 3, byMemory: true });
	});
});
