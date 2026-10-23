import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AsyncResource } from "webappwiz/disposable";

describe("the runner bootstrap", () => {
	let home: string;
	let release: FakeRelease;
	let port: number;

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "bootstrap-"));
		release = new FakeRelease();
		const free = Bun.serve({ port: 0, fetch: () => new Response() });
		port = free.port ?? 0;
		await free.stop(true);
	});

	afterEach(async () => {
		await release.disposeAsync();
		await rm(home, { recursive: true, force: true });
	});

	function boot(env: Record<string, string>, ...args: string[]) {
		return Bun.spawn(
			["sh", join(import.meta.dir, "bootstrap.sh.txt"), ...args],
			{
				env: {
					PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
					HOME: home,
					SPLATES_BINARY_URL: release.url,
					SPLATES_RUNNER_PORT: String(port),
					SPLATES_RUNNER_SECRET: "the-secret",
					...env,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
	}

	it("fetches the binary, checks it, serves jobs, and keeps it for the next boot", async () => {
		const first = boot({}, "--extra");
		expect(await new Response(first.stdout).text()).toBe(
			`release runners serve --port ${port} --extra\n`,
		);
		expect(await first.exited).toBe(0);
		const again = boot({ SPLATES_BINARY_SHA256: release.sha256 });
		expect(await new Response(again.stdout).text()).toBe(
			`release runners serve --port ${port}\n`,
		);
		expect(release.fetches).toBe(1);
	});

	it("refuses a binary whose checksum is not the one asked for", async () => {
		const booted = boot({ SPLATES_BINARY_SHA256: "b".repeat(64) });
		expect(await booted.exited).not.toBe(0);
		expect(await new Response(booted.stderr).text()).toContain(
			`not ${"b".repeat(64)}`,
		);
		expect(await readdir(join(home, ".cache/splates"))).toEqual([]);
	});

	it("waits for a checkout's gzipped build and runs it with the binary as bun", async () => {
		const booted = boot({ SPLATES_AWAIT_BUILD: "1" });
		const waiting = await once(buildAt(port), { headers: AUTH });
		expect([waiting.status, waiting.headers.get("x-splates-runner")]).toEqual([
			409,
			"build",
		]);
		expect((await fetch(buildAt(port), { method: "PUT" })).status).toBe(401);
		const build = 'console.log("own", process.argv.slice(2).join(" "))';
		const put = await fetch(buildAt(port), {
			method: "PUT",
			headers: AUTH,
			body: Bun.gzipSync(new TextEncoder().encode(build)),
		});
		expect(put.status).toBe(200);
		expect(await new Response(booted.stdout).text()).toBe(
			`own runners serve --port ${port}\n`,
		);
		expect(await booted.exited).toBe(0);
	});
});

/** Where a runner waiting for its build on `port` takes it. */
function buildAt(port: number): string {
	return `http://127.0.0.1:${port}/api/build`;
}

/** The runner's secret, as whoever reaches it shows it. */
const AUTH = { authorization: "Bearer the-secret" };

/** Stands in for the compiled binary: bun itself with `BUN_BE_BUN`, else it says how it was run. */
const BINARY = `#!/bin/sh
if [ -n "\${BUN_BE_BUN:-}" ]; then exec bun "$@"; fi
echo "release $*"
`;

/** The answer from `url` once something listens there, asking again while nothing does. */
async function once(url: string, init: RequestInit): Promise<Response> {
	const answer = await fetch(url, init).catch(() => null);
	if (answer !== null) {
		return answer;
	}
	await Bun.sleep(50);
	return once(url, init);
}

/** A release's downloads: the binary and its checksum, counting each fetch of the binary. */
class FakeRelease implements AsyncResource {
	fetches = 0;
	readonly sha256 = createHash("sha256").update(BINARY).digest("hex");
	private readonly server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (request) => {
			const path = new URL(request.url).pathname;
			if (path === "/splates-linux-x64") {
				this.fetches++;
				return new Response(BINARY);
			}
			if (path === "/splates-linux-x64.sha256") {
				return new Response(`${this.sha256}  splates-linux-x64\n`);
			}
			return new Response("Not Found", { status: 404 });
		},
	});

	get url(): string {
		return `http://127.0.0.1:${this.server.port}/splates-linux-x64`;
	}

	async disposeAsync(): Promise<void> {
		await this.server.stop(true);
	}
}
