import { describe, expect, it } from "bun:test";
import { Visits } from "./visits";

const all = () => true;

describe("Visits", () => {
	it("goes back and forward through what was opened", () => {
		const visits = new Visits();
		visits.visit("c1");
		visits.visit("c2");
		visits.visit("c3");

		expect(visits.back(all)).toBe("c2");
		visits.visit("c2");
		expect(visits.back(all)).toBe("c1");
		expect(visits.back(all)).toBeNull();
		expect(visits.forward(all)).toBe("c2");
		expect(visits.forward(all)).toBe("c3");
		expect(visits.forward(all)).toBeNull();
	});

	it("drops what was ahead when another opens after going back", () => {
		const visits = new Visits();
		visits.visit("c1");
		visits.visit("c2");
		visits.back(all);

		visits.visit("c3");
		expect(visits.forward(all)).toBeNull();
		expect(visits.back(all)).toBe("c1");
	});

	it("skips one that is gone", () => {
		const visits = new Visits();
		visits.visit("c1");
		visits.visit("c2");
		visits.visit("c3");
		const kept = (id: string) => id !== "c2";

		expect(visits.back(kept)).toBe("c1");
		expect(visits.forward(kept)).toBe("c3");
		expect(visits.back((id) => id === "c3")).toBeNull();
	});

	it("goes back to the last one from none", () => {
		const visits = new Visits();
		visits.leave();
		expect(visits.back(all)).toBeNull();

		visits.visit("c1");
		visits.leave();
		expect(visits.back(all)).toBe("c1");
		expect(visits.back(all)).toBeNull();
	});
});
