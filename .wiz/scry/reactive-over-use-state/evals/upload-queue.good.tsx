import { useReactive } from "@webappwiz/react";
import { Dispatcher, type Eventful } from "webappwiz/events";

type UploadQueueEvents = { changed: undefined };

export class UploadQueue implements Eventful<UploadQueueEvents> {
	private readonly dispatcher = new Dispatcher<UploadQueueEvents>();
	readonly events = this.dispatcher.events;

	pending: File[] = [];
	uploaded = 0;
	failed: File[] = [];

	constructor(private readonly storage: Storage) {}

	async add(file: File): Promise<void> {
		this.pending = [...this.pending, file];
		this.dispatcher.dispatch("changed");
		try {
			await this.storage.put(file);
			this.uploaded += 1;
		} catch {
			this.failed = [...this.failed, file];
		}
		this.pending = this.pending.filter((other) => other !== file);
		this.dispatcher.dispatch("changed");
	}
}

export function UploadStatus({ queue }: { queue: UploadQueue }) {
	const { pending, uploaded, failed } = useReactive(
		queue,
		(queue) => ({ pending: queue.pending.length, uploaded: queue.uploaded, failed: queue.failed.length }),
		["changed"],
	);

	return (
		<p>
			{uploaded} uploaded, {pending} in progress, {failed} failed
		</p>
	);
}
