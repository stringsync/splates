import { WorkerProtocol } from "./protocol";

/** A frame the far end could never take, refused at send rather than replayed for ever. */
export class FrameTooLarge extends Error {
	constructor(readonly bytes: number) {
		super(
			`a frame of ${bytes} bytes is over the ${WorkerProtocol.maxFrameBytes} the link carries`,
		);
	}
}
