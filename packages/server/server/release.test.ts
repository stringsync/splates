import { describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodePs } from "core/system";
import { isNewer, newest, stuckSource } from "./release";

const ps = new NodePs();

async function git(cwd: string, ...args: string[]): Promise<string> {
	const { exitCode, stdout, stderr } = await ps.spawnCapture([
		"git",
		"-C",
		cwd,
		...args,
	]);
	if (exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
	}
	return stdout.trim();
}

describe("release", () => {
	it("compares by major, minor and patch, never calling a prerelease newer", () => {
		expect(isNewer("0.0.44", "0.0.43")).toBe(true);
		expect(isNewer("0.1.0", "0.0.99")).toBe(true);
		expect(isNewer("0.0.10", "0.0.9")).toBe(true);
		expect(isNewer("0.0.43", "0.0.43")).toBe(false);
		expect(isNewer("0.0.42", "0.0.43")).toBe(false);
		expect(isNewer("0.0.44-beta.1", "0.0.43")).toBe(false);
	});

	it("reads the latest version off the registry, and null for anything else", async () => {
		const answers: Record<string, () => Response> = {
			"/ok": () => Response.json({ version: "1.2.3" }),
			"/missing": () => new Response("nope", { status: 404 }),
			"/garbage": () => new Response("not json"),
			"/odd": () => Response.json({ version: "latest" }),
		};
		const registry = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) =>
				(answers[new URL(request.url).pathname] ?? answers["/missing"])?.() ??
				new Response(null, { status: 500 }),
		});
		try {
			const at = (path: string) =>
				newest(`http://127.0.0.1:${registry.port}${path}`);
			expect(await at("/ok")).toBe("1.2.3");
			expect(await at("/missing")).toBeNull();
			expect(await at("/garbage")).toBeNull();
			expect(await at("/odd")).toBeNull();
		} finally {
			await registry.stop(true);
		}
		expect(await newest(`http://127.0.0.1:${registry.port}/ok`)).toBeNull();
	});

	it("reports when a checkout is behind its upstream on server source commits", async () => {
		const base = realpathSync(mkdtempSync(join(tmpdir(), "splates-stuck-")));
		try {
			const bare = join(base, "origin.git");
			const local = join(base, "local");
			const other = join(base, "other");
			await git(base, "init", "--bare", bare);
			await git(base, "clone", bare, local);
			await git(local, "config", "user.email", "test@example.com");
			await git(local, "config", "user.name", "Test");

			// Initial commit with server source and another directory.
			const srcDir = join(local, "server");
			const otherDir = join(local, "other");
			await ps.spawnCapture(["mkdir", "-p", srcDir, otherDir]);
			writeFileSync(join(srcDir, "a.ts"), "export const a = 1;\n");
			writeFileSync(join(otherDir, "b.ts"), "export const b = 1;\n");
			await git(local, "add", ".");
			await git(local, "commit", "-m", "initial");
			const branch = await git(local, "branch", "--show-current");
			await git(local, "push", "-u", "origin", branch);

			// Up to date with upstream -> not stuck.
			expect(await stuckSource(ps, [srcDir])).toBeNull();

			// Push a commit touching only a non-source directory from another clone.
			await git(base, "clone", bare, other);
			await git(other, "config", "user.email", "test@example.com");
			await git(other, "config", "user.name", "Test");
			writeFileSync(join(other, "other/b.ts"), "export const b = 2;\n");
			await git(other, "commit", "-am", "non-source change");
			await git(other, "push", "origin", branch);
			await git(local, "fetch", "origin");

			// Non-source commits on upstream do not mark server checkout stuck.
			expect(await stuckSource(ps, [srcDir])).toBeNull();

			// Push two commits touching server source.
			const localCommit = await git(local, "rev-parse", "HEAD");
			writeFileSync(join(other, "server/a.ts"), "export const a = 2;\n");
			await git(other, "commit", "-am", "server change 1");
			writeFileSync(join(other, "server/a.ts"), "export const a = 3;\n");
			await git(other, "commit", "-am", "server change 2");
			const upstreamHead = await git(other, "rev-parse", "HEAD");
			await git(other, "push", "origin", branch);
			await git(local, "fetch", "origin");

			// Dirty tracked file + untracked scratch file (only tracked counts).
			writeFileSync(join(local, "other/b.ts"), "export const b = 999;\n");
			writeFileSync(join(local, "scratch.txt"), "untracked\n");

			expect(await stuckSource(ps, [srcDir])).toEqual({
				upstream: `origin/${branch}`,
				local: localCommit,
				newest: upstreamHead,
				commits: 2,
				root: local,
				dirty: 1,
			});

			// Once local checkout cleans up and fast-forwards, stuck clears.
			await git(local, "checkout", "--", "other/b.ts");
			await git(local, "merge", "--ff-only", `origin/${branch}`);
			expect(await stuckSource(ps, [srcDir])).toBeNull();
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});
});
