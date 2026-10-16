import { z } from "zod";

/** A JSON value, as control frames carry them. */
export type Json =
	| string
	| number
	| boolean
	| null
	| Json[]
	| { [key: string]: Json };

/** Each channel's last seq one end holds, as `[channel, seq]` pairs. */
export type Held = [channel: number, seq: number][];

/**
 * Every frame on the link between a coordinator and a worker. Those naming a
 * `channel` carry its seq and are kept until acked, so they survive a
 * reconnect; the rest belong to one connection and are never replayed.
 */
export type Frame =
	| {
			type: "hello";
			protocol: string;
			capabilities: string[];
			id: string;
			info: { [key: string]: Json };
			held: Held;
	  }
	| { type: "welcome"; protocol: string; capabilities: string[]; held: Held }
	| { type: "refuse"; reason: string }
	| { type: "open"; channel: number; seq: number; kind: string; params: Json }
	| { type: "message"; channel: number; seq: number; body: Json }
	| { type: "data"; channel: number; seq: number; bytes: Uint8Array }
	| { type: "close"; channel: number; seq: number }
	| { type: "ack"; acks: Held }
	| { type: "ping"; n: number }
	| { type: "pong"; n: number };

/** A frame that belongs to a channel, so it has a seq and is replayed. */
export type ChannelFrame = Extract<Frame, { channel: number }>;

/** What one end makes of the other's version, from its hello or welcome. */
export type Negotiated =
	| { ok: true; protocol: string; capabilities: string[] }
	| { ok: false; reason: string };

/**
 * Turns frames into what a `WorkerSocket` carries and back, and settles which
 * version two ends speak. A `WorkerSession` uses it for every frame; reach for
 * it directly only to speak the protocol without one.
 */
export class WorkerProtocol {
	private constructor() {}

	/** Bump the major for a change an older end would misread. */
	static readonly version = "1.0";

	static readonly headerBytes = 8;

	static encode(frame: Frame): string | Uint8Array {
		// Control frames go as JSON text; data goes as binary, a channel id and
		// seq (big-endian u32 each) ahead of the bytes, so output streams
		// without base64.
		if (frame.type !== "data") {
			return JSON.stringify(frame);
		}
		const encoded = new Uint8Array(
			WorkerProtocol.headerBytes + frame.bytes.byteLength,
		);
		const view = new DataView(encoded.buffer);
		view.setUint32(0, frame.channel);
		view.setUint32(4, frame.seq);
		encoded.set(frame.bytes, WorkerProtocol.headerBytes);
		return encoded;
	}

	/** Throws on anything that is not a frame, which ends the connection. */
	static decode(encoded: string | Uint8Array): Frame {
		if (typeof encoded === "string") {
			return frameSchema.parse(JSON.parse(encoded)) as Frame;
		}
		if (encoded.byteLength < WorkerProtocol.headerBytes) {
			throw new Error(
				`a data frame needs an ${WorkerProtocol.headerBytes}-byte header, got ${encoded.byteLength} bytes`,
			);
		}
		const view = new DataView(
			encoded.buffer,
			encoded.byteOffset,
			encoded.byteLength,
		);
		return {
			type: "data",
			channel: view.getUint32(0),
			seq: view.getUint32(4),
			bytes: encoded.subarray(WorkerProtocol.headerBytes),
		};
	}

	/**
	 * Settles on the lower minor and the capabilities both ends have; another
	 * major cannot be read, so it is refused with a reason the coordinator
	 * shows when it drains that worker.
	 */
	static negotiate(
		ours: { protocol: string; capabilities: string[] },
		theirs: { protocol: string; capabilities: string[] },
	): Negotiated {
		const [ourMajor, ourMinor] = parseVersion(ours.protocol);
		const [theirMajor, theirMinor] = parseVersion(theirs.protocol);
		if (Number.isNaN(theirMajor) || ourMajor !== theirMajor) {
			return {
				ok: false,
				reason: `speaks protocol ${theirs.protocol}, and this end speaks ${ours.protocol}: update the older one`,
			};
		}
		const shared = new Set(theirs.capabilities);
		return {
			ok: true,
			protocol: `${ourMajor}.${Math.min(ourMinor, theirMinor)}`,
			capabilities: ours.capabilities.filter((name) => shared.has(name)),
		};
	}
}

const json: z.ZodType<Json> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(json),
		z.record(z.string(), json),
	]),
);
const id = z.number().int().nonnegative();
const held = z.array(z.tuple([id, id]));
const frameSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hello"),
		protocol: z.string(),
		capabilities: z.array(z.string()),
		id: z.string(),
		info: z.record(z.string(), json),
		held,
	}),
	z.object({
		type: z.literal("welcome"),
		protocol: z.string(),
		capabilities: z.array(z.string()),
		held,
	}),
	z.object({ type: z.literal("refuse"), reason: z.string() }),
	z.object({
		type: z.literal("open"),
		channel: id,
		seq: id,
		kind: z.string(),
		params: json,
	}),
	z.object({
		type: z.literal("message"),
		channel: id,
		seq: id,
		body: json,
	}),
	z.object({ type: z.literal("close"), channel: id, seq: id }),
	z.object({ type: z.literal("ack"), acks: held }),
	z.object({ type: z.literal("ping"), n: id }),
	z.object({ type: z.literal("pong"), n: id }),
]);

function parseVersion(version: string): [major: number, minor: number] {
	const match = /^(\d+)\.(\d+)$/.exec(version);
	return match
		? [Number(match[1]), Number(match[2])]
		: [Number.NaN, Number.NaN];
}
