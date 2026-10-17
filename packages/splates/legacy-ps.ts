import type { Resource } from "webappwiz/disposable";
import {
	type Child,
	NodePs,
	type Ps,
	type SpawnCaptureResult,
	type SpawnOptions,
	type SpawnResult,
	type StartOptions,
	type TerminalChild,
	type TerminalOptions,
} from "webappwiz/system";
import { legacyName, legacyWarnings } from "./legacy-names";

/**
 * A `Ps` that reads each `SPLATES_*` variable under its `ARBOR_*` name too,
 * warning once, and sets both names on every child, so a `wiz` or skill still
 * reading the old ones sees what splates means.
 */
export class LegacyNamesPs implements Ps {
	constructor(private readonly inner: Ps) {}

	get platform(): NodeJS.Platform {
		return this.inner.platform;
	}
	get pid(): number {
		return this.inner.pid;
	}
	get hostname(): string {
		return this.inner.hostname;
	}
	get args(): string[] {
		return this.inner.args;
	}
	get self(): string[] {
		return this.inner.self;
	}

	env(name: string): string | undefined {
		const value = this.inner.env(name);
		const old = legacyName(name);
		if (value !== undefined || old === null) {
			return value;
		}
		const legacy = this.inner.env(old);
		if (legacy !== undefined) {
			legacyWarnings.once(old, name);
		}
		return legacy;
	}

	columns(): number | undefined {
		return this.inner.columns();
	}

	alive(pid: number): boolean {
		return this.inner.alive(pid);
	}
	spawn(argv: string[], opts?: SpawnOptions): Promise<SpawnResult> {
		return this.inner.spawn(argv, withLegacyEnv(opts));
	}
	spawnCapture(
		argv: string[],
		opts?: SpawnOptions,
	): Promise<SpawnCaptureResult> {
		return this.inner.spawnCapture(argv, withLegacyEnv(opts));
	}
	start(argv: string[], opts?: StartOptions): Child {
		return this.inner.start(argv, withLegacyEnv(opts));
	}
	startOnTerminal(argv: string[], opts: TerminalOptions): TerminalChild {
		return this.inner.startOnTerminal(argv, withLegacyEnv(opts));
	}
	processes(): ReturnType<Ps["processes"]> {
		return this.inner.processes();
	}
	listening(): ReturnType<Ps["listening"]> {
		return this.inner.listening();
	}
	cwd(): string {
		return this.inner.cwd();
	}
	cd(path: string): void {
		this.inner.cd(path);
	}
	exit(code: number): void {
		this.inner.exit(code);
	}
	on(signal: string, handler: (...args: unknown[]) => void): Resource {
		return this.inner.on(signal, handler);
	}
	once(event: "exit", handler: () => void): Resource {
		return this.inner.once(event, handler);
	}
}

/** The machine's processes, under both names. */
export function systemPs(): Ps {
	return new LegacyNamesPs(new NodePs());
}

function withLegacyEnv<
	T extends { env?: Record<string, string>; unset?: string[] } | undefined,
>(opts: T): T {
	if (
		opts === undefined ||
		(opts.env === undefined && opts.unset === undefined)
	) {
		return opts;
	}
	const env = { ...opts.env };
	for (const [name, value] of Object.entries(opts.env ?? {})) {
		const old = legacyName(name);
		if (old !== null && !(old in env)) {
			env[old] = value;
		}
	}
	const unset = (opts.unset ?? []).flatMap((name) => {
		const old = legacyName(name);
		return old === null ? [name] : [name, old];
	});
	return {
		...opts,
		...(opts.env === undefined ? {} : { env }),
		...(opts.unset === undefined ? {} : { unset }),
	} as T;
}
