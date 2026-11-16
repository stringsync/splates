import { expect, test } from "bun:test";
import { withWebmDuration } from "./webm-duration";

test("adds a Duration in milliseconds to an Info that has none", () => {
	const out = withWebmDuration(webm(SCALE), 12_345);
	const at = out.findIndex((_, i) => out[i] === 0x44 && out[i + 1] === 0x89);
	expect(out[at + 2]).toBe(0x88);
	expect(new DataView(out.buffer).getFloat64(at + 3)).toBe(12_345);
	expect(out.length).toBe(webm(SCALE).length + 11 + 7);
	// The element after Info is intact.
	expect([...out.slice(-5)]).toEqual([0x16, 0x54, 0xae, 0x6b, 0x80]);
});

test("leaves a WebM that has a Duration, and bytes that are not a WebM, alone", () => {
	const done = withWebmDuration(webm(SCALE), 1000);
	expect(withWebmDuration(done, 5000)).toBe(done);
	const junk = new Uint8Array([1, 2, 3]);
	expect(withWebmDuration(junk, 1000)).toBe(junk);
});

/** EBML header, an unknown-size Segment, and an Info holding a TimecodeScale, then a Tracks stub. */
function webm(info: number[]): Uint8Array {
	return new Uint8Array([
		0x1a,
		0x45,
		0xdf,
		0xa3,
		0x83,
		0x42,
		0x86,
		0x81, // EBML header (stub)
		0x18,
		0x53,
		0x80,
		0x67,
		0x01,
		0xff,
		0xff,
		0xff,
		0xff,
		0xff,
		0xff,
		0xff,
		0x15,
		0x49,
		0xa9,
		0x66,
		0x80 | info.length,
		...info,
		0x16,
		0x54,
		0xae,
		0x6b,
		0x80,
	]);
}

const SCALE = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
