import { z } from "zod";

/** The capability of a worker that sends a Wake-on-LAN packet when asked (protocol 1.4). */
export const WAKE = "wake";

/** The port a magic packet goes to, which every Wake-on-LAN adapter listens for. */
export const WAKE_PORT = 9;

const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

/**
 * What waking a sleeping machine takes: the MAC address of its network
 * adapter, and the broadcast address of that adapter's network, where the
 * packet goes, since a sleeping machine has no address to send to.
 */
export const WakeTarget = z.object({
	mac: z.string().regex(MAC),
	broadcast: z.ipv4(),
});
export type WakeTarget = z.infer<typeof WakeTarget>;

/** `mac` written as a target keeps it, from any of `aa:bb…`, `AA-BB-…`; null for no MAC. */
export function macOf(mac: string): string | null {
	const written = mac.trim().toLowerCase().replaceAll("-", ":");
	return MAC.test(written) && written !== "00:00:00:00:00:00" ? written : null;
}

/**
 * The magic packet that wakes the adapter `mac`: six bytes of 0xff, then
 * its six bytes sixteen times over.
 */
export function magicPacket(mac: string): Uint8Array {
	const written = macOf(mac);
	if (written === null) {
		throw new Error(`${mac} is not a MAC address`);
	}
	const bytes = written.split(":").map((each) => Number.parseInt(each, 16));
	const packet = new Uint8Array(6 + 16 * 6);
	packet.fill(0xff, 0, 6);
	for (let at = 0; at < 16; at++) {
		packet.set(bytes, 6 + at * 6);
	}
	return packet;
}

/** The broadcast address of the network `address` is on, as `netmask` or a prefix length marks it. */
export function broadcastOf(address: string, netmask: string | number): string {
	const ip = toInt(address);
	const mask =
		typeof netmask === "number"
			? netmask === 0
				? 0
				: (0xffffffff << (32 - netmask)) >>> 0
			: toInt(netmask);
	const broadcast = (ip | ~mask) >>> 0;
	return [24, 16, 8, 0].map((shift) => (broadcast >>> shift) & 0xff).join(".");
}

function toInt(address: string): number {
	return (
		address
			.split(".")
			.reduce((sum, part) => ((sum << 8) | Number(part)) >>> 0, 0) >>> 0
	);
}

/** Sends the magic packet that wakes a sleeping machine. */
export interface WakeSender {
	send(target: WakeTarget): Promise<void>;
}
