import type {
	SpawnOptions,
	StartOptions,
	TerminalOptions,
} from "webappwiz/system";
import { FakePs, type FakeTerminalChild } from "webappwiz/system/testing";

/**
 * OpenCode 2 as Setup sees it, for tests, never a real account: its
 * metadata commands, an npm install, a login prompt on a terminal, and an
 * ACP server that answers initialize only.
 */
export class OpenCodeFixturePs extends FakePs {
	installed = true;
	/** Whether npm's install succeeds, making OpenCode installed. */
	installs = true;
	connected = true;
	conflict = false;
	unavailable = false;
	protocol = 1;
	/** The keys typed at OpenCode's login prompt. */
	keys: string[] = [];
	/** Every ACP method asked. */
	requests: string[] = [];
	/** Every OpenCode and npm command run, with its env. */
	commands: Array<{ argv: string[]; env?: Record<string, string> }> = [];

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		this.commands.push({ argv, env: opts?.env });
		if (argv[0] === "npm") {
			this.installed ||= this.installs;
			return { exitCode: this.installs ? 0 : 1, stdout: "", stderr: "" };
		}
		if (!this.installed) {
			throw new Error("fixture unavailable; private diagnostic");
		}
		const command = argv.slice(1).join(" ");
		const config = JSON.parse(opts?.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
		let stdout: string;
		if (command === "--version") {
			stdout = "opencode v2.0.32";
		} else if (command.startsWith("auth list")) {
			stdout = JSON.stringify(
				this.connected
					? [{ id: "opencode-go", connections: [{ type: "credential" }] }]
					: [],
			);
		} else if (command.startsWith("models")) {
			stdout = this.unavailable
				? "opencode-go/Small"
				: "opencode-go/Main\nopencode-go/Small";
		} else if (command.startsWith("api config.get")) {
			stdout = JSON.stringify([
				{ type: "directory", path: "/home/.config/opencode" },
				{ type: "document", info: this.echo(config) },
			]);
		} else {
			throw new Error(`Unexpected fixture metadata command: ${command}`);
		}
		return { exitCode: 0, stdout, stderr: "" };
	}

	override startOnTerminal(
		argv: string[],
		opts: TerminalOptions,
	): FakeTerminalChild {
		const child = super.startOnTerminal(argv, opts);
		this.commands.push({ argv, env: opts.env });
		child.print("◆  Enter your OpenCode Go API key\r\n");
		const write = child.write.bind(child);
		child.write = (data) => {
			write(data);
			const key =
				typeof data === "string" ? data : new TextDecoder().decode(data);
			this.keys.push(key.replace(/\r$/, ""));
			this.connected = true;
			child.print("◇  Connected to OpenCode Go\r\n");
			child.exit(0);
		};
		return child;
	}

	override start(argv: string[], opts?: StartOptions) {
		const child = super.start(argv, opts);
		void (async () => {
			for await (const bytes of child.received) {
				const message = JSON.parse(new TextDecoder().decode(bytes));
				this.requests.push(message.method);
				if (message.method !== "initialize") {
					throw new Error("Fixture accepts initialize only");
				}
				child.print(
					`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: this.protocol, agentCapabilities: {}, authMethods: [] } })}\n`,
				);
			}
		})().catch(() => child.kill());
		return child;
	}

	/** The inline config as OpenCode 2 echoes it, models split by provider. */
	private echo(config: Record<string, unknown>): Record<string, unknown> {
		const split = (id: string) => {
			const [providerID, ...model] = id.split("/");
			return {
				providerID: this.conflict ? "opencode" : providerID,
				model: model.join("/"),
			};
		};
		const agents = config.agents as
			| Record<string, { model: string }>
			| undefined;
		return {
			...config,
			...(typeof config.model === "string"
				? { model: split(config.model) }
				: {}),
			...(agents
				? {
						agents: Object.fromEntries(
							Object.entries(agents).map(([name, agent]) => [
								name,
								{ model: split(agent.model) },
							]),
						),
					}
				: {}),
		};
	}
}
