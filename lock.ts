import { rmSync } from "node:fs";
import { color } from "@webappwiz/log";
import type { Ctx } from "./context";

interface Holder {
	pid: number;
	hostname: string;
	at: string;
}

export interface Lock {
	release(): Promise<void>;
}

const POLL_MS = 2_000;

/**
 * The land mutex. `mkdir` is the whole mechanism: it is atomic on every
 * filesystem and either creates the directory or fails, so there is no
 * check-then-write window to lose.
 *
 * Blocks until the lock is free. That is deliberate — returning "busy" invites
 * an agent to go edit more code in a branch that is supposed to be frozen.
 */
export async function acquire(
	ctx: Ctx,
	{ pollMs = POLL_MS }: { pollMs?: number } = {},
): Promise<Lock> {
	const holderPath = `${ctx.lockPath}/holder.json`;
	let unreadableSince: number | null = null;

	for (let waited = false; ; waited = true) {
		try {
			await ctx.fs.mkdir(ctx.lockPath, { recursive: false });
		} catch {
			const holder = await readHolder(ctx, holderPath);
			if (holder === null) {
				// A holder that never wrote its metadata: give the winner time to
				// finish writing before deciding the directory is orphaned.
				unreadableSince ??= Date.now();
				if (Date.now() - unreadableSince > ctx.config.leaseStalenessMs) {
					steal(ctx, "lock has no holder metadata");
					continue;
				}
			} else if (isStale(ctx, holder)) {
				steal(ctx, `holder pid ${holder.pid} is gone or stale`);
				continue;
			}
			await Bun.sleep(pollMs);
			continue;
		}
		if (waited) {
			ctx.log.error("graft lock acquired");
		}
		break;
	}

	const holder: Holder = {
		pid: ctx.ps.pid,
		hostname: ctx.ps.hostname,
		at: new Date().toISOString(),
	};
	await ctx.fs.write(holderPath, JSON.stringify(holder));

	let released = false;
	const drop = (): void => {
		if (!released) {
			released = true;
			// Sync: exit handlers cannot await, and a crashed holder that never
			// releases wedges every other agent. This is the important line.
			rmSync(ctx.lockPath, { recursive: true, force: true });
		}
	};
	ctx.ps.once("exit", drop);
	for (const signal of ["SIGINT", "SIGTERM"]) {
		ctx.ps.on(signal, () => {
			drop();
			ctx.ps.exit(130);
		});
	}
	ctx.ps.on("uncaughtException", (e: unknown) => {
		drop();
		ctx.log.error(e);
		ctx.ps.exit(1);
	});

	return {
		async release(): Promise<void> {
			if (!released) {
				released = true;
				await ctx.fs.rm(ctx.lockPath, { recursive: true, force: true });
			}
		},
	};
}

async function readHolder(ctx: Ctx, path: string): Promise<Holder | null> {
	const raw = await ctx.fs.read(path).catch(() => null);
	try {
		return raw === null ? null : (JSON.parse(raw) as Holder);
	} catch {
		return null;
	}
}

function isStale(ctx: Ctx, holder: Holder): boolean {
	if (Date.now() - Date.parse(holder.at) > ctx.config.leaseStalenessMs) {
		return true;
	}
	return holder.hostname === ctx.ps.hostname && !ctx.ps.alive(holder.pid);
}

function steal(ctx: Ctx, why: string): void {
	ctx.log.error(color.yellow(`arbor: stealing stale graft lock (${why})`));
	rmSync(ctx.lockPath, { recursive: true, force: true });
}
