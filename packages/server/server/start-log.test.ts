import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { assets } from "./assets";
import { type DevFlags, serveDev } from "./start";

const flags: DevFlags = {
	port: 4269,
	"allow-hosts": "",
	"access-team": "team",
	"access-aud": "",
	tunnel: "",
	"tunnel-name": "",
	"ports-host": "",
	keepalive: false,
	slot: false,
};

describe("Server diagnostic logs", () => {
	it.each([
		[undefined, "server-supervisor.log"],
		["1", "server.log"],
	])(
		"keeps a startup failure in %s's log before it rejects",
		async (serving, name) => {
			const fs = new FakeFs();
			const ps = new FakePs();
			ps.setEnv({
				SPLATES_HOME: "/state",
				...(serving ? { SPLATES_DEV_SERVING: serving } : {}),
			});
			const log = new MemoryLogger();
			await fs.mkdir("/state");

			await expect(serveDev({ fs, ps, log, assets }, flags)).rejects.toThrow(
				"Cloudflare Access needs both --access-team and --access-aud",
			);

			const written = await fs.read(`/state/${name}`);
			expect(written).toContain("error");
			expect(written).toContain(
				"Cloudflare Access needs both --access-team and --access-aud",
			);
			expect(log.entries).toHaveLength(1);
			expect(await fs.exists(`/state/${name}.1`)).toBe(false);
		},
	);
});
