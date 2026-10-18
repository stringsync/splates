import { stripVTControlCharacters } from "node:util";
import * as acp from "@agentclientprotocol/sdk";
import type { Fs, Ps } from "webappwiz/system";
import { framed } from "./agent-process";
import { AgentStream } from "./agent-stream";
import { OpenCodeModelError } from "./setup-opencode-model-error";
import {
	OpenCodeModels,
	type OpenCodeSelection,
} from "./setup-opencode-models";

/** How Setup installs OpenCode; nothing from the page reaches the command. */
export const OPENCODE_INSTALL = [
	"npm",
	"install",
	"--global",
	"@opencode/cli@latest",
];

/**
 * How Setup logs OpenCode in to Go; `OpenCodeSetup.login` types the key at
 * its prompt, on a terminal of its own.
 */
export const OPENCODE_LOGIN = [
	"opencode",
	"auth",
	"login",
	"opencode-go",
	"--method",
	"key",
	"--standalone",
];

/**
 * OpenCode on this machine as Setup reads and changes it: each check runs
 * OpenCode afresh, so a page loaded after a restart reads what is there.
 * None sends a prompt; native output never reaches the page, which gets
 * fixed lines instead.
 */
export class OpenCodeSetup {
	readonly models: OpenCodeModels;
	/** The roster as last verified ready, to tell whether it still is. */
	#verified: string | null = null;

	constructor(
		private readonly deps: {
			fs: Fs;
			ps: Ps;
			home: string;
			/** Has open projects read the roster again once it changes. */
			roster?: () => Promise<void>;
		},
	) {
		this.models = new OpenCodeModels(deps, {
			run: (args, signal, env, cwd) => this.command(args, signal, env, cwd),
		});
	}

	/** Where Setup runs OpenCode, away from any project's configuration. */
	get cwd(): string {
		return `${this.deps.home}/setup-opencode`;
	}

	/** The installed OpenCode's version, or null when none answers. */
	async version(): Promise<string | null> {
		const output = await this.command(
			["--version"],
			AbortSignal.timeout(15_000),
		).catch(() => null);
		const version = output?.trim().replace(/^opencode v/, "") ?? "";
		return /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) ? version : null;
	}

	/** Installs OpenCode with npm, throwing a line for the page on failure. */
	async install(): Promise<void> {
		const result = await this.deps.ps
			.spawnCapture(OPENCODE_INSTALL, {
				cwd: await this.prepare(),
				timeoutMs: 10 * 60_000,
				stdin: "",
			})
			.catch(() => null);
		if (result === null) {
			throw new Error(
				"Could not run npm. Install Node.js, then press Try again.",
			);
		}
		if (result.exitCode !== 0) {
			throw new Error(
				`npm could not install OpenCode. Run \`${OPENCODE_INSTALL.join(" ")}\` in a terminal to see why.`,
			);
		}
	}

	/**
	 * Whether OpenCode keeps a Go credential, from its public auth listing;
	 * false when OpenCode does not answer.
	 */
	async connected(): Promise<boolean> {
		const output = await this.command(
			["auth", "list", "--format", "json", "--standalone"],
			AbortSignal.timeout(15_000),
		).catch(() => null);
		try {
			return output !== null && storedGo(JSON.parse(output));
		} catch {
			return false;
		}
	}

	/**
	 * Hands OpenCode the Go `key` at its own login prompt, on a terminal of
	 * its own, so OpenCode keeps a copy and works outside splates too.
	 */
	async login(key: string): Promise<void> {
		// On a terminal: OpenCode refuses a key on piped stdin, and one in argv
		// would show in `ps`.
		const child = this.deps.ps.startOnTerminal([...OPENCODE_LOGIN], {
			cwd: await this.prepare(),
			cols: 120,
			rows: 30,
			env: { TERM: "xterm-256color" },
		});
		const decoder = new TextDecoder();
		let screen = "";
		let typed = false;
		const timer = setTimeout(() => child.kill("SIGHUP"), 60_000);
		try {
			void (async () => {
				for await (const bytes of child.output) {
					screen += decoder.decode(bytes, { stream: true });
					if (!typed && /API key/i.test(stripVTControlCharacters(screen))) {
						typed = true;
						child.write(new TextEncoder().encode(`${key}\r`));
					}
				}
			})().catch(() => {});
			const code = await child.exited;
			if (code !== 0 || !typed) {
				throw new Error(
					"OpenCode did not take the key. Check it, then press Try again.",
				);
			}
		} finally {
			clearTimeout(timer);
			child.close();
		}
		this.models.invalidate();
	}

	/** Checks that OpenCode speaks ACP as splates does; sends no prompt. */
	async handshake(cwd?: string, env?: Record<string, string>): Promise<void> {
		const signal = AbortSignal.timeout(15_000);
		const child = this.deps.ps.start(["opencode", "acp"], {
			cwd: cwd ?? (await this.prepare()),
			env,
			signal,
			timeoutMs: 15_000,
		});
		let aborted: (() => void) | undefined;
		// Drain and discard stderr: it may hold native provider diagnostics.
		void (async () => {
			for await (const _bytes of child.stderr) {
			}
		})().catch(() => {});
		try {
			const connection = new acp.ClientSideConnection(
				() => ({
					sessionUpdate: async () => {},
					requestPermission: async () => ({
						outcome: { outcome: "cancelled" },
					}),
				}),
				new AgentStream({
					pid: child.pid,
					input: child.stdin,
					output: framed(child.stdout),
					ack: () => {},
					handle: null,
					stderr: () => "",
					exited: child.exited,
					kill: () => child.kill(),
				}),
			);
			const response = await Promise.race([
				connection.initialize({
					protocolVersion: acp.PROTOCOL_VERSION,
					clientCapabilities: {},
				}),
				child.exited.then((): never => {
					throw new Error("exited");
				}),
				new Promise<never>((_, reject) => {
					aborted = () => reject(signal.reason);
					signal.addEventListener("abort", aborted, { once: true });
				}),
			]);
			if (response.protocolVersion !== acp.PROTOCOL_VERSION) {
				throw new Error("protocol version");
			}
		} catch {
			throw new Error(
				"OpenCode did not answer splates over ACP. Update OpenCode, then press Try again.",
			);
		} finally {
			if (aborted !== undefined) {
				signal.removeEventListener("abort", aborted);
			}
			child.kill();
		}
	}

	/** Saves `selection` as the roster's OpenCode recipe. */
	async choose(selection: OpenCodeSelection): Promise<void> {
		await this.prepare();
		await this.models.save(selection, AbortSignal.timeout(60_000));
		await this.deps.roster?.();
	}

	/**
	 * Checks the saved recipe with OpenCode in `cwd`: its models still
	 * listed, its configuration in effect, ACP answering. Sends no prompt.
	 */
	async verify(cwd?: string): Promise<OpenCodeSelection> {
		const where = cwd ?? (await this.prepare());
		const recipe = await this.models.recipes.stored();
		if (recipe === null) {
			throw new OpenCodeModelError("Choose the models first.");
		}
		try {
			const signal = AbortSignal.timeout(60_000);
			await this.models.verifyStored(recipe, where, signal);
			await this.handshake(where, recipe.env);
			await this.models.recipes.unchanged(recipe, signal);
		} catch (error) {
			throw error instanceof OpenCodeModelError
				? error
				: new Error(
						"OpenCode could not check the saved models. Press Try again.",
					);
		}
		this.#verified = recipe.raw;
		return { model: recipe.model, auxiliary: recipe.auxiliary };
	}

	/** Whether the recipe on the roster is the one `verify` last passed. */
	async ready(): Promise<boolean> {
		return (
			this.#verified !== null &&
			(await this.models.recipes.rawRoster()) === this.#verified
		);
	}

	/** Takes the recipe off the roster; OpenCode's own login stays. */
	async disable(): Promise<void> {
		await this.models.recipes.disable(AbortSignal.timeout(15_000));
		this.models.invalidate();
		this.#verified = null;
		await this.deps.roster?.();
	}

	async prepare(): Promise<string> {
		await this.deps.fs.mkdir(this.cwd, { recursive: true });
		return this.cwd;
	}

	private async command(
		args: string[],
		signal: AbortSignal,
		env?: Record<string, string>,
		cwd?: string,
	): Promise<string> {
		signal.throwIfAborted();
		const result = await this.deps.ps.spawnCapture(["opencode", ...args], {
			cwd: cwd ?? (await this.prepare()),
			env,
			signal,
			timeoutMs: 15_000,
			stdin: "",
		});
		if (result.exitCode !== 0) {
			throw new Error("command failed");
		}
		return stripVTControlCharacters(result.stdout);
	}
}

/** Auth list is public metadata, never auth export or the native credential file. */
function storedGo(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.some(
			(item) =>
				typeof item === "object" &&
				item !== null &&
				item.id === "opencode-go" &&
				Array.isArray(item.connections) &&
				item.connections.some(
					(entry: unknown) =>
						typeof entry === "object" &&
						entry !== null &&
						"type" in entry &&
						entry.type === "credential",
				),
		)
	);
}
