import { describe, expect, it } from "bun:test";
import { WorkerProtocol } from "./worker-protocol";

describe("WorkerProtocol", () => {
	it("round-trips a control frame as JSON text", () => {
		const frame = {
			type: "open" as const,
			channel: 2,
			seq: 1,
			kind: "process",
			params: { argv: ["claude"], env: { TERM: "xterm" } },
		};

		const encoded = WorkerProtocol.encode(frame);

		expect(typeof encoded).toBe("string");
		expect(WorkerProtocol.decode(encoded)).toEqual(frame);
	});

	it("puts a data frame's channel and seq in an 8-byte header ahead of its bytes", () => {
		const encoded = WorkerProtocol.encode({
			type: "data",
			channel: 7,
			seq: 300,
			bytes: new Uint8Array([104, 105]),
		});

		expect(encoded).toEqual(
			new Uint8Array([0, 0, 0, 7, 0, 0, 1, 44, 104, 105]),
		);
		expect(WorkerProtocol.decode(encoded)).toEqual({
			type: "data",
			channel: 7,
			seq: 300,
			bytes: new Uint8Array([104, 105]),
		});
	});

	it("rejects a data frame shorter than its header", () => {
		expect(() => WorkerProtocol.decode(new Uint8Array([0, 1]))).toThrow(
			"8-byte header",
		);
	});

	it("rejects text that is not a known frame", () => {
		expect(() => WorkerProtocol.decode('{"type":"shout"}')).toThrow();
	});

	it("settles on the lower minor and the capabilities both ends have", () => {
		expect(
			WorkerProtocol.negotiate(
				{ protocol: "1.4", capabilities: ["pty", "ports", "relay"] },
				{ protocol: "1.2", capabilities: ["relay", "pty"] },
			),
		).toEqual({ ok: true, protocol: "1.2", capabilities: ["pty", "relay"] });
	});

	it("refuses another major with a reason naming both versions", () => {
		expect(
			WorkerProtocol.negotiate(
				{ protocol: "1.0", capabilities: [] },
				{ protocol: "2.3", capabilities: [] },
			),
		).toEqual({
			ok: false,
			refused: true,
			reason:
				"speaks protocol 2.3, and this end speaks 1.0: update the older one",
		});
	});

	it("refuses a version that is not major.minor", () => {
		expect(
			WorkerProtocol.negotiate(
				{ protocol: "1.0", capabilities: [] },
				{ protocol: "latest", capabilities: [] },
			).ok,
		).toBe(false);
	});
});
