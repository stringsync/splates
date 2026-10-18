import { describe, expect, it } from "bun:test";
import { createSocket } from "node:dgram";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import {
	broadcastOf,
	macOf,
	magicPacket,
	networkOf,
	UdpWakeSender,
	WindowsWakeSender,
	wakeSenderOf,
} from "./wake";

describe("Wake-on-LAN", () => {
	it("makes the magic packet: six 0xff, then the MAC sixteen times", () => {
		const mac = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x01];

		expect([...magicPacket("AA-BB-CC-DD-EE-01")]).toEqual([
			...Array(6).fill(0xff),
			...Array(16).fill(mac).flat(),
		]);
	});

	it("reads a MAC however Windows or Linux writes it", () => {
		expect(macOf("AA-BB-CC-DD-EE-01")).toBe("aa:bb:cc:dd:ee:01");
		expect(macOf("aa:bb:cc:dd:ee:01")).toBe("aa:bb:cc:dd:ee:01");
		expect(macOf("00:00:00:00:00:00")).toBeNull();
		expect(macOf("not a mac")).toBeNull();
	});

	it("finds the broadcast address from a netmask or a prefix length", () => {
		expect(broadcastOf("192.168.1.42", "255.255.255.0")).toBe("192.168.1.255");
		expect(broadcastOf("10.0.5.9", 16)).toBe("10.0.255.255");
		expect(broadcastOf("172.20.3.4", 22)).toBe("172.20.3.255");
	});

	it("sends the packet over UDP, where a sleeping adapter listens", async () => {
		const listener = createSocket("udp4");
		await new Promise<void>((resolve) =>
			listener.bind(0, "127.0.0.1", resolve),
		);
		const heard = new Promise<Buffer>((resolve) =>
			listener.once("message", resolve),
		);
		try {
			await new UdpWakeSender(listener.address().port).send({
				mac: "aa:bb:cc:dd:ee:01",
				broadcast: "127.0.0.1",
			});

			expect([...(await heard)]).toEqual([...magicPacket("aa:bb:cc:dd:ee:01")]);
		} finally {
			listener.close();
		}
	});

	it("sends from the Windows side under WSL, whose own broadcasts stay behind its NAT", async () => {
		const ps = new FakePs();
		ps.setEnv({ WSL_DISTRO_NAME: "splates" });

		expect(wakeSenderOf(ps)).toBeInstanceOf(WindowsWakeSender);
		await new WindowsWakeSender(ps).send({
			mac: "aa:bb:cc:dd:ee:01",
			broadcast: "192.168.1.255",
		});

		const [call] = ps.getCalls();
		expect(call).toStartWith("powershell.exe");
		expect(call).toContain("$b = [byte[]](255,255,255,255,255,255,170,187,");
		expect(call).toContain("'192.168.1.255', 9");
	});

	it("says what waking a WSL worker takes from Windows' adapter", async () => {
		const ps = new FakePs();
		ps.setEnv({ WSL_DISTRO_NAME: "splates" });
		ps.setCaptureOutput(
			'{"mac":"AA-BB-CC-DD-EE-01","address":"192.168.1.42","prefix":24}',
			"",
		);

		expect(await networkOf(ps, new MemoryLogger())).toEqual({
			broadcasts: ["192.168.1.255"],
			wake: { mac: "aa:bb:cc:dd:ee:01", broadcast: "192.168.1.255" },
		});
	});

	it("says nothing of waking a WSL worker whose adapter it cannot read", async () => {
		const ps = new FakePs();
		ps.setEnv({ WSL_DISTRO_NAME: "splates" });
		ps.setCaptureOutput("", "");
		const log = new MemoryLogger();

		expect(await networkOf(ps, log)).toEqual({ broadcasts: [], wake: null });
		expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
			"cannot be woken",
		);
	});

	it("gives every adapter's broadcast elsewhere, and no way to wake it", async () => {
		const network = await networkOf(new FakePs(), new MemoryLogger());

		expect(network.wake).toBeNull();
		expect(network.broadcasts).not.toContain("127.255.255.255");
	});
});
