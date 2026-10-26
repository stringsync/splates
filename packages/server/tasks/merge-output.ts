import type { Resource } from "webappwiz/disposable";
import type { Fs } from "webappwiz/system";
import { Duration, type Timer } from "webappwiz/time";
import type { WorktreeService } from "./worktree-service";

/** How often a merge step's output is read again while it runs. */
const OUTPUT_EVERY = Duration.ms(250);

/**
 * What step `index` of `task`'s merge under way printed, then more as it
 * prints, ending once the step is over and all of it is read; null when the
 * merge has no such step, or it runs no command.
 */
export async function mergeOutput(
	{ service, fs, timer }: { service: WorktreeService; fs: Fs; timer: Timer },
	task: string,
	index: number,
): Promise<ReadableStream<Uint8Array> | null> {
	const path = (await service.find(task)).mergeSteps?.steps[index]?.output;
	if (path === undefined) {
		return null;
	}
	// A task gone, as once it lands, has no step running.
	const running = async () => {
		const steps = (await service.find(task).catch(() => null))?.mergeSteps
			?.steps;
		return steps !== undefined && steps[index]?.output === path
			? index === steps.length - 1
			: false;
	};
	let read = 0;
	let cancelled = false;
	let waiting: Resource | null = null;
	const next = async (
		stream: ReadableStreamDefaultController<Uint8Array>,
	): Promise<void> => {
		if (cancelled) {
			return;
		}
		// Asked before reading, so what it printed last is read once it ends.
		const going = await running();
		const bytes = (await fs.exists(path))
			? await fs.readBytes(path)
			: new Uint8Array(0);
		if (bytes.byteLength > read) {
			stream.enqueue(bytes.slice(read));
			read = bytes.byteLength;
		}
		if (!going) {
			stream.close();
			return;
		}
		waiting = timer.setTimeout(() => {
			void next(stream).catch((error: unknown) => stream.error(error));
		}, OUTPUT_EVERY);
	};
	return new ReadableStream<Uint8Array>({
		start: (stream) => next(stream),
		cancel: () => {
			cancelled = true;
			waiting?.dispose();
		},
	});
}
