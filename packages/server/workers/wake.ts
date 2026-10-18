import { networkInterfaces } from "node:os";
import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { hostOf } from "./machine";
import {
	broadcastOf,
	macOf,
	type WakeSender,
	type WakeTarget,
} from "./magic-packet";
import { UdpWakeSender } from "./udp-wake-sender";
import { WindowsWakeSender } from "./windows-wake-sender";

export {
	broadcastOf,
	macOf,
	magicPacket,
	WAKE,
	WAKE_PORT,
	type WakeSender,
	WakeTarget,
} from "./magic-packet";
export { UdpWakeSender } from "./udp-wake-sender";
export { WindowsWakeSender } from "./windows-wake-sender";

/**
 * What a worker says of its network in its hello: the broadcast addresses
 * it can send a magic packet to, and, for one that may sleep, what waking
 * it takes.
 */
export interface WorkerNetwork {
	broadcasts: string[];
	wake: WakeTarget | null;
}

/** What sends a magic packet from this machine: from Windows under WSL, else over UDP here. */
export function wakeSenderOf(ps: Ps): WakeSender {
	return hostOf(ps) === "wsl2"
		? new WindowsWakeSender(ps)
		: new UdpWakeSender();
}

/**
 * The Windows adapter that reaches the network, the one with a default
 * gateway, as JSON: its MAC, address and prefix length.
 */
const WINDOWS_ADAPTER = [
	"$c = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1",
	"$a = @($c.IPv4Address)[0]",
	"[pscustomobject]@{ mac = $c.NetAdapter.MacAddress; address = $a.IPAddress; prefix = [int]$a.PrefixLength } | ConvertTo-Json -Compress",
].join("; ");

const WindowsAdapter = z.object({
	mac: z.string(),
	address: z.ipv4(),
	prefix: z.number().int().min(0).max(32),
});

/**
 * This machine's network as a worker says it. Under WSL it is the Windows
 * side's, read through `powershell.exe`, since WSL2 sees only a virtual
 * adapter, and the PC may sleep, so it says what waking it takes. Elsewhere
 * it is every adapter's broadcast address, for sending a packet to a
 * sleeping one; nothing in splates lets a machine there sleep, so none says
 * how to wake it. Logs and says nothing it cannot read.
 */
export async function networkOf(ps: Ps, log: Logger): Promise<WorkerNetwork> {
	if (hostOf(ps) !== "wsl2") {
		return { broadcasts: localBroadcasts(), wake: null };
	}
	try {
		const { exitCode, stdout, stderr } = await ps.spawnCapture([
			"powershell.exe",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			WINDOWS_ADAPTER,
		]);
		if (exitCode !== 0) {
			throw new Error(stderr.trim());
		}
		const adapter = WindowsAdapter.parse(JSON.parse(stdout));
		const mac = macOf(adapter.mac);
		if (mac === null) {
			throw new Error(`${adapter.mac} is not a MAC address`);
		}
		const broadcast = broadcastOf(adapter.address, adapter.prefix);
		return { broadcasts: [broadcast], wake: { mac, broadcast } };
	} catch (error) {
		log.error(
			`cannot read Windows' network, so this PC cannot be woken once it sleeps: ${error instanceof Error ? error.message : String(error)}`,
		);
		return { broadcasts: [], wake: null };
	}
}

/** The broadcast address of each network this machine's adapters are on, loopback left out. */
function localBroadcasts(): string[] {
	const broadcasts = new Set<string>();
	for (const addresses of Object.values(networkInterfaces())) {
		for (const each of addresses ?? []) {
			if (each.family === "IPv4" && !each.internal) {
				broadcasts.add(broadcastOf(each.address, each.netmask));
			}
		}
	}
	return [...broadcasts];
}
