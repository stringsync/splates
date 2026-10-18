import { createSocket } from "node:dgram";
import {
	magicPacket,
	WAKE_PORT,
	type WakeSender,
	type WakeTarget,
} from "./magic-packet";

/** Broadcasts the packet over UDP from this machine. */
export class UdpWakeSender implements WakeSender {
	constructor(private readonly port = WAKE_PORT) {}

	send(target: WakeTarget): Promise<void> {
		const packet = magicPacket(target.mac);
		const socket = createSocket("udp4");
		return new Promise<void>((resolve, reject) => {
			socket.once("error", reject);
			socket.bind(() => {
				socket.setBroadcast(true);
				socket.send(packet, this.port, target.broadcast, (error) =>
					error ? reject(error) : resolve(),
				);
			});
		}).finally(() => socket.close());
	}
}
