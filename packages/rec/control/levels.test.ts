import { expect, test } from "bun:test";
import { litSegments, SEGMENTS, zoneOf } from "./levels";

test("silence lights nothing and full scale lights everything", () => {
	expect(litSegments(0)).toBe(0);
	expect(litSegments(Number.NaN)).toBe(0);
	expect(litSegments(1)).toBe(SEGMENTS);
	expect(litSegments(3)).toBe(SEGMENTS);
});

test("normal speech stays green and a loud peak reaches red", () => {
	const speech = litSegments(10 ** (-26 / 20));
	expect(zoneOf(speech - 1)).toBe("green");
	const loud = litSegments(10 ** (-9 / 20));
	expect(zoneOf(loud - 1)).toBe("yellow");
	expect(zoneOf(litSegments(10 ** (-0.5 / 20)) - 1)).toBe("red");
});

test("zones are green up to -12 dBFS, yellow up to -6, red above", () => {
	const zones = Array.from({ length: SEGMENTS }, (_, i) => zoneOf(i));
	expect(zones.filter((zone) => zone === "green")).toHaveLength(19);
	expect(zones.filter((zone) => zone === "yellow")).toHaveLength(2);
	expect(zones.filter((zone) => zone === "red")).toHaveLength(3);
});
