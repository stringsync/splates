import type { AsyncResource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Fs } from "webappwiz/system";
import { UNIX_HANDLERS, UnixWorkerSocket } from "./unix-worker-socket";

/** What a `UnixWorkerListener` hears: a worker dialed in. */
export interface UnixWorkerListenerEvents extends Record<string, unknown> {
	socket: UnixWorkerSocket;
}

/**
 * Where the local worker dials its coordinator: a Unix socket only this
 * user may open. Listening takes the path over from a coordinator that died
 * without cleaning up, and refuses one still answering there.
 */
export class UnixWorkerListener
	implements Eventful<UnixWorkerListenerEvents>, AsyncResource
{
	private readonly dispatcher = new Dispatcher<UnixWorkerListenerEvents>();
	readonly events = this.dispatcher.events;

	private constructor(
		readonly path: string,
		private readonly listener: Bun.UnixSocketListener<UnixWorkerSocket>,
		private readonly fs: Fs,
	) {}

	static async listen(path: string, fs: Fs): Promise<UnixWorkerListener> {
		if (await fs.exists(path)) {
			const answered = await UnixWorkerSocket.connect(path).then(
				(socket) => {
					socket.dispose();
					return true;
				},
				() => false,
			);
			if (answered) {
				throw new Error(`another coordinator is listening at ${path}`);
			}
			await fs.rm(path, { force: true });
		}
		let listening: UnixWorkerListener | undefined;
		const listener = Bun.listen<UnixWorkerSocket>({
			unix: path,
			socket: {
				...UNIX_HANDLERS,
				open: (socket) => {
					const adapter = new UnixWorkerSocket();
					socket.data = adapter;
					adapter.attach(socket);
					listening?.dispatcher.dispatch("socket", adapter);
				},
			},
		});
		listening = new UnixWorkerListener(path, listener, fs);
		await fs.chmod(path, 0o600);
		return listening;
	}

	async disposeAsync(): Promise<void> {
		this.listener.stop(true);
		this.dispatcher.dispose();
		await this.fs.rm(this.path, { force: true });
	}
}
