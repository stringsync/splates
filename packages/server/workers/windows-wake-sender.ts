import type { Ps } from "webappwiz/system";
import {
	magicPacket,
	WAKE_PORT,
	type WakeSender,
	type WakeTarget,
} from "./magic-packet";

/**
 * A `WakeSender` for a worker under WSL2: give it to the worker to wake the
 * machines on its PC's network. `wakeSenderOf` picks it under WSL.
 */
// Through `powershell.exe` on the Windows side: WSL2 sits behind a NAT,
// and a broadcast from inside it never reaches the PC's network.
export class WindowsWakeSender implements WakeSender {
	constructor(private readonly ps: Ps) {}

	async send(target: WakeTarget): Promise<void> {
		// Windows PowerShell runs on .NET Framework, which reads no hex.
		const bytes = [...magicPacket(target.mac)].join(",");
		const script = [
			`$b = [byte[]](${bytes})`,
			"$c = New-Object System.Net.Sockets.UdpClient",
			"$c.EnableBroadcast = $true",
			`$null = $c.Send($b, $b.Length, '${target.broadcast}', ${WAKE_PORT})`,
			"$c.Close()",
		].join("; ");
		const { exitCode, stderr } = await this.ps.spawnCapture([
			"powershell.exe",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			script,
		]);
		if (exitCode !== 0) {
			throw new Error(
				`powershell.exe could not send the packet: ${stderr.trim()}`,
			);
		}
	}
}
