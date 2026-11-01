import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { MemoryLogger } from "core/log";
import { FakeFs, FakePs } from "core/system/testing";
import { assets } from "./assets";
import { type DevFlags, serveDev } from "./start";
import { NO_WORKER } from "./supervise";

const flags: DevFlags = {
	port: 4269,
	"allow-hosts": "",
	"access-team": "",
	"access-aud": "",
	tunnel: "",
	"tunnel-name": "",
	"ports-host": "",
	keepalive: false,
	slot: false,
};

describe("A second server on a home another server holds", () => {
	it("runs no worker and tells its child to start no tunnel", async () => {
		const home = mkdtempSync(`${tmpdir()}/splates-home-`);
		const listener = Bun.listen({
			unix: `${home}/worker.sock`,
			socket: { data() {} },
		});
		try {
			const fs = new FakeFs();
			const ps = new FakePs();
			ps.setEnv({ SPLATES_HOME: home });
			const spawned: { argv: string[]; env: Record<string, string> }[] = [];
			// Not in a repository, so no config is loaded.
			ps.spawnCapture = async () => ({ exitCode: 1, stdout: "", stderr: "" });
			ps.spawn = async (argv, opts) => {
				spawned.push({ argv, env: opts?.env ?? {} });
				return { exitCode: 0 };
			};
			const log = new MemoryLogger();
			await fs.mkdir(home);

			await serveDev({ fs, ps, log, assets }, flags).catch(() => undefined);

			expect(spawned.some((each) => each.argv.includes("worker"))).toBe(false);
			expect(spawned.map((each) => each.env[NO_WORKER])).toEqual(["1"]);
			expect(
				log.entries.some((entry) =>
					String(entry.message).includes("no worker or tunnel"),
				),
			).toBe(true);
		} finally {
			listener.stop(true);
			rmSync(home, { recursive: true, force: true });
		}
	});
});
