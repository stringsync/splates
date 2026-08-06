import { expect, test } from "bun:test";
import { fixture } from "./fixture";
import { acquire } from "./lock";

test("a second acquire blocks until the first releases", async () => {
	const f = await fixture();
	const order: string[] = [];

	const first = await acquire(f.ctx, { pollMs: 10 });
	order.push("first-in");

	const second = acquire(f.ctx, { pollMs: 10 }).then(async (lock) => {
		order.push("second-in");
		await lock.release();
	});

	await Bun.sleep(50);
	expect(order).toEqual(["first-in"]); // still waiting on the mutex

	order.push("first-out");
	await first.release();
	await second;

	expect(order).toEqual(["first-in", "first-out", "second-in"]);
	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	await f.cleanup();
});

test("a lock held by a dead pid is stolen, loudly", async () => {
	const f = await fixture();
	const dead = 999_001;
	await f.ctx.fs.mkdir(f.ctx.lockPath, { recursive: false });
	await f.ctx.fs.write(
		`${f.ctx.lockPath}/holder.json`,
		JSON.stringify({
			pid: dead,
			hostname: f.ps.hostname,
			at: new Date().toISOString(), // fresh heartbeat: only the dead pid gives it away
		}),
	);
	f.ps.markDead(dead);

	const lock = await acquire(f.ctx, { pollMs: 10 });

	expect(f.out()).toContain("stealing stale graft lock");
	const holder = JSON.parse(
		await f.ctx.fs.read(`${f.ctx.lockPath}/holder.json`),
	);
	expect(holder.pid).toBe(f.ps.pid);
	await lock.release();
	await f.cleanup();
});

test("a lock older than the staleness window is stolen even if the pid lives", async () => {
	const f = await fixture({ leaseStalenessMs: 50 });
	await f.ctx.fs.mkdir(f.ctx.lockPath, { recursive: false });
	await f.ctx.fs.write(
		`${f.ctx.lockPath}/holder.json`,
		JSON.stringify({
			pid: f.ps.pid,
			hostname: f.ps.hostname,
			at: new Date(Date.now() - 10_000).toISOString(),
		}),
	);

	const lock = await acquire(f.ctx, { pollMs: 10 });

	expect(f.out()).toContain("stealing stale graft lock");
	await lock.release();
	await f.cleanup();
});

test("a crash releases the lock — SIGINT removes it and exits", async () => {
	const f = await fixture();

	await acquire(f.ctx, { pollMs: 10 });
	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(true);

	f.ps.dispatch("SIGINT");

	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	expect(f.ps.lastExit()).toBe(130);
	await f.cleanup();
});

test("process exit removes a lock nobody released", async () => {
	const f = await fixture();

	await acquire(f.ctx, { pollMs: 10 });
	f.ps.dispatch("exit");

	expect(await f.ctx.fs.exists(f.ctx.lockPath)).toBe(false);
	await f.cleanup();
});
