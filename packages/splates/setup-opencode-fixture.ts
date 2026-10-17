import type { SpawnOptions, StartOptions } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";

/** Synthetic V2 metadata for tests and visual review, never a real account. */
export class OpenCodeFixturePs extends FakePs {
	installed = true;
	connected = true;
	conflict = false;
	unavailable = false;
	offline = false;
	protocol = 1;
	requests: string[] = [];
	metadata: Array<{ argv: string[]; cwd?: string }> = [];
	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		this.metadata.push({ argv, cwd: opts?.cwd });
		if (!this.installed || this.offline) {
			throw new Error("fixture unavailable; private diagnostic");
		}
		const command = argv.slice(1).join(" ");
		const config = JSON.parse(opts?.env?.OPENCODE_CONFIG_CONTENT ?? "{}");
		let stdout: string;
		if (command === "--version") {
			stdout = "2.0.0-fixture";
		} else if (command.endsWith("--help")) {
			stdout = "target --method --standalone --format --param";
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
				{ type: "document", info: config },
				...(this.conflict
					? [{ type: "document", info: { model: "opencode/Other" } }]
					: []),
			]);
		} else if (command.startsWith("api agent.list")) {
			stdout = JSON.stringify({
				data: ["build", "plan", "title", "compaction"].map((id) => ({
					id,
					...(config.agents
						? {
								model: {
									providerID: "opencode-go",
									id: config.agents[id]?.model.slice("opencode-go/".length),
								},
							}
						: {}),
				})),
			});
		} else {
			throw new Error(`Unexpected fixture metadata command: ${command}`);
		}
		return { exitCode: 0, stdout, stderr: "" };
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
}
