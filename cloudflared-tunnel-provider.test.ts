import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodePs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import {
	CloudflaredTunnelProvider,
	GUARD,
} from "./cloudflared-tunnel-provider";

describe("CloudflaredTunnelProvider", () => {
	let ps: FakePs;
	let log: MemoryLogger;

	beforeEach(() => {
		ps = new FakePs();
		log = new MemoryLogger();
	});

	it("runs cloudflared at the url, says once where it is up, and stops on dispose", async () => {
		const run = new CloudflaredTunnelProvider(ps, "mine").run({
			host: "arbor.example.com",
			url: "http://localhost:4269",
			log,
		});
		const [child] = ps.getChildren();

		expect(ps.getCalls()).toEqual([
			`sh -c ${GUARD} sh cloudflared tunnel --no-autoupdate run --url http://localhost:4269 mine`,
		]);
		child?.printError(
			[0, 1, 2, 3]
				.map((index) => `INF Registered tunnel connection connIndex=${index}\n`)
				.join(""),
		);
		await Bun.sleep(10);
		await run.disposeAsync();

		expect(child?.signals).toEqual(["SIGTERM"]);
		expect(log.entries).toEqual([
			expect.objectContaining({
				message: "arbor dev reachable at https://arbor.example.com",
			}),
		]);
	});

	it("hands a token over in the environment, never the argv", async () => {
		const run = new CloudflaredTunnelProvider(ps, null, "secret").run({
			host: "arbor.example.com",
			url: "http://localhost:4270",
			log,
		});
		await run.disposeAsync();

		expect(ps.getCalls()).toEqual([
			`sh -c ${GUARD} sh cloudflared tunnel --no-autoupdate run --url http://localhost:4270`,
		]);
		expect(ps.getCallEnvs()).toEqual([{ TUNNEL_TOKEN: "secret" }]);
	});

	it.skipIf(process.platform === "win32")(
		"kills cloudflared once arbor dev's end of its stdin closes, as when arbor dev dies",
		async () => {
			const { child, pid } = await guarded(["sleep", "30"]);

			await child.stdin.close();

			expect(await child.exited).toBe(143);
			expect(new NodePs().alive(pid)).toBe(false);
		},
	);

	it.skipIf(process.platform === "win32")(
		"passes a SIGTERM to the guard on to cloudflared",
		async () => {
			const { child, pid } = await guarded(["sleep", "30"]);

			child.kill();

			expect(await child.exited).toBe(143);
			expect(new NodePs().alive(pid)).toBe(false);
		},
	);

	it.skipIf(process.platform === "win32")(
		"exits with cloudflared's status while stdin stays open",
		async () => {
			const child = new NodePs().start([
				"sh",
				"-c",
				GUARD,
				"sh",
				"sh",
				"-c",
				"exit 3",
			]);

			expect(await child.exited).toBe(3);
		},
	);
});

/** Starts `command` under the guard, and finds the pid it runs as. */
async function guarded(command: string[]) {
	const real = new NodePs();
	const child = real.start(["sh", "-c", GUARD, "sh", ...command]);
	for (let i = 0; i < 300; i++) {
		const listed = (await real.processes()).find(
			(each) => each.ppid === child.pid && each.command === command.join(" "),
		);
		if (listed !== undefined) {
			return { child, pid: listed.pid };
		}
		await Bun.sleep(10);
	}
	throw new Error(`${command.join(" ")} never started`);
}
