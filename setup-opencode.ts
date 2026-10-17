import { stripVTControlCharacters } from "node:util";
import * as acp from "@agentclientprotocol/sdk";
import type { Fs, Ps } from "webappwiz/system";
import { framed } from "./agent-process";
import { AgentStream } from "./agent-stream";
import {
	type OpenCodeModelState,
	OpenCodeModels,
} from "./setup-opencode-models";

/** Observations only: a stored credential is not proof of entitlement or inference. */
export interface OpenCodeStatus {
	version: string | null;
	auth: "unchecked" | "missing" | "stored" | "unsupported";
	protocol: "unchecked" | "compatible" | "failed";
	checking: boolean;
	problem: string | null;
	checkedAt: string | null;
}

/** Fixed native actions; no arguments, credentials or commands come from the page. */
export const OPENCODE_INSTALL = [
	"npm",
	"install",
	"--global",
	"@opencode/cli@latest",
];
export const OPENCODE_LOGIN = [
	"opencode",
	"auth",
	"login",
	"opencode-go",
	"--method",
	"key",
	"--standalone",
];

/** Non-billed installation, native-auth metadata and initialize-only ACP checks. */
export class OpenCodeSetup {
	private status: OpenCodeStatus = {
		version: null,
		auth: "unchecked",
		protocol: "unchecked",
		checking: false,
		problem: null,
		checkedAt: null,
	};
	private pending: Promise<OpenCodeStatus> | null = null;
	private controller: AbortController | null = null;

	readonly models: OpenCodeModels;
	constructor(private readonly deps: { fs: Fs; ps: Ps; home: string }) {
		this.models = new OpenCodeModels(deps, {
			run: (args, signal, env) => this.command(args, signal, env),
		});
	}

	async configure(
		operation: (signal: AbortSignal) => Promise<OpenCodeModelState>,
	): Promise<OpenCodeModelState> {
		if (this.status.checking) {
			throw new Error("busy");
		}
		if (
			this.status.auth !== "stored" ||
			this.status.protocol !== "compatible" ||
			this.status.problem
		) {
			throw new Error("Check installation and native Go authentication first.");
		}
		const controller = new AbortController();
		this.controller = controller;
		this.status.checking = true;
		try {
			return await operation(controller.signal);
		} finally {
			this.status.checking = false;
			this.controller = null;
		}
	}

	get cwd(): string {
		return `${this.deps.home}/setup-opencode`;
	}
	read(): OpenCodeStatus {
		return { ...this.status };
	}
	async prepare(): Promise<void> {
		await this.deps.fs.mkdir(this.cwd, { recursive: true });
	}

	check(): Promise<OpenCodeStatus> {
		if (this.status.checking && this.pending === null) {
			return Promise.resolve(this.read());
		}
		if (this.pending !== null) {
			return this.pending;
		}
		this.models.invalidate();
		const controller = new AbortController();
		this.controller = controller;
		this.status = {
			version: null,
			auth: "unchecked",
			protocol: "unchecked",
			checking: true,
			problem: null,
			checkedAt: null,
		};
		this.pending = this.probe(controller.signal).finally(() => {
			this.pending = null;
			this.controller = null;
		});
		return this.pending;
	}

	/** Native actions can change credentials; require new observations afterwards. */
	invalidate(): void {
		this.models.invalidate();
		this.status.auth = "unchecked";
		this.status.protocol = "unchecked";
		this.status.checkedAt = null;
		this.status.problem = null;
	}

	cancel(): void {
		this.controller?.abort();
		this.models.cancel();
	}

	private async command(
		args: string[],
		signal: AbortSignal,
		env?: Record<string, string>,
	): Promise<string> {
		signal.throwIfAborted();
		const result = await this.deps.ps.spawnCapture(["opencode", ...args], {
			cwd: this.cwd,
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

	private async probe(signal: AbortSignal): Promise<OpenCodeStatus> {
		let problem =
			"OpenCode was not found or could not report its version. Install it, then check again. If already installed, restart arbor so it sees the updated PATH.";
		try {
			await this.prepare();
			const version = (await this.command(["--version"], signal)).trim();
			// Never reflect arbitrary process output (including provider errors) into the page.
			if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
				throw new Error("version");
			}
			this.status.version = version;
			problem =
				"This OpenCode version does not expose the supported native login and JSON authentication listing. Update OpenCode using its official installation instructions, then retry.";
			const login = await this.command(["auth", "login", "--help"], signal);
			const list = await this.command(["auth", "list", "--help"], signal);
			this.status.auth = "unsupported";
			if (
				!login.includes("--standalone") ||
				!login.includes("--method") ||
				!/\btarget\b/i.test(login) ||
				!list.includes("--format")
			) {
				throw new Error("auth interface");
			}
			problem =
				"OpenCode could not list its native authentication. Retry, or reconnect your existing Go account.";
			const listing: unknown = JSON.parse(
				await this.command(
					["auth", "list", "--format", "json", "--standalone"],
					signal,
				),
			);
			this.status.auth = storedGo(listing) ? "stored" : "missing";
			problem =
				"OpenCode could not complete the ACP handshake. Update or repair the installation, then retry. No model prompt was sent.";
			this.status.protocol = "failed";
			await this.handshake(signal);
			this.status.protocol = "compatible";
			this.status.problem = null;
		} catch {
			this.status.problem = signal.aborted
				? "Check canceled. You can retry."
				: problem;
		} finally {
			this.status.checking = false;
			this.status.checkedAt = new Date().toISOString();
		}
		return this.read();
	}

	private async handshake(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const child = this.deps.ps.start(["opencode", "acp"], {
			cwd: this.cwd,
			signal,
			timeoutMs: 15_000,
		});
		// Drain and discard stderr: it may contain native provider diagnostics.
		void (async () => {
			for await (const _bytes of child.stderr) {
				/* Discard native diagnostics. */
			}
		})().catch(() => {});
		const process = {
			pid: child.pid,
			input: child.stdin,
			output: framed(child.stdout),
			ack: () => {},
			handle: null,
			stderr: () => "",
			exited: child.exited,
			kill: () => child.kill(),
		};
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let aborted: (() => void) | undefined;
		try {
			const connection = new acp.ClientSideConnection(
				() => ({
					sessionUpdate: async () => {},
					requestPermission: async () => ({
						outcome: { outcome: "cancelled" },
					}),
				}),
				new AgentStream(process),
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
					timeout = setTimeout(() => reject(new Error("timeout")), 15_000);
					aborted = () => reject(new Error("canceled"));
					signal.addEventListener("abort", aborted, { once: true });
					if (signal.aborted) {
						aborted();
					}
				}),
			]);
			if (response.protocolVersion !== acp.PROTOCOL_VERSION) {
				throw new Error("protocol version");
			}
		} finally {
			clearTimeout(timeout);
			if (aborted !== undefined) {
				signal.removeEventListener("abort", aborted);
			}
			child.kill();
		}
	}
}

/** Auth list is public metadata, never auth export or the native credential file. */
function storedGo(value: unknown): boolean {
	if (!Array.isArray(value)) {
		throw new Error("unknown auth listing");
	}
	for (const item of value) {
		if (
			typeof item !== "object" ||
			item === null ||
			typeof item.id !== "string" ||
			!Array.isArray(item.connections)
		) {
			throw new Error("unknown auth entry");
		}
		if (item.id === "opencode-go") {
			return item.connections.some(
				(entry: unknown) =>
					typeof entry === "object" &&
					entry !== null &&
					"type" in entry &&
					entry.type === "credential",
			);
		}
	}
	return false;
}
