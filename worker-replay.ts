import type { ChannelFrame, Held } from "./worker-protocol";

interface Kept {
	frame: ChannelFrame;
	encoded: string | Uint8Array;
	order: number;
}

/**
 * The channel frames one end has sent and the other has yet to ack, kept to
 * send again on a reconnect. Its bound is in bytes: past it, `keep` still
 * keeps the frame, so nothing is lost, but says the writer should stop.
 */
export class WorkerReplay {
	private readonly channels = new Map<number, Kept[]>();
	private nextOrder = 0;
	private _bytes = 0;

	constructor(readonly limit: number) {}

	get bytes(): number {
		return this._bytes;
	}

	get full(): boolean {
		return this._bytes >= this.limit;
	}

	/** Keeps a frame until acked, and says whether there is room for more. */
	keep(frame: ChannelFrame, encoded: string | Uint8Array): boolean {
		const kept = this.channels.get(frame.channel) ?? [];
		kept.push({ frame, encoded, order: this.nextOrder++ });
		this.channels.set(frame.channel, kept);
		this._bytes += size(encoded);
		return !this.full;
	}

	/** Drops every frame of each channel up to the seq the other end holds. */
	/** Lets go of every frame, for an other end that will never ack them. */
	clear(): void {
		this.channels.clear();
		this._bytes = 0;
	}

	ack(acks: Held): void {
		for (const [channel, seq] of acks) {
			const kept = this.channels.get(channel);
			while (kept?.[0] && kept[0].frame.seq <= seq) {
				const dropped = kept.shift();
				this._bytes -= dropped ? size(dropped.encoded) : 0;
			}
			if (kept?.length === 0) {
				this.channels.delete(channel);
			}
		}
	}

	/** Every frame still kept, in the order it was first sent. */
	unacked(): (string | Uint8Array)[] {
		return [...this.channels.values()]
			.flat()
			.sort((left, right) => left.order - right.order)
			.map((kept) => kept.encoded);
	}
}

function size(encoded: string | Uint8Array): number {
	return typeof encoded === "string" ? encoded.length : encoded.byteLength;
}
