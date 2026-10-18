import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { CLAUDE_AREA, CODEX_AREA } from "./area-native";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

/** A machine whose CLIs answer as `programs` says: a command's exit code, by its words. */
class CliPs extends FakePs {
	constructor(private readonly programs: Record<string, number>) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		return {
			exitCode: this.programs[argv.join(" ")] ?? 127,
			stdout: "",
			stderr: "",
		};
	}
}

const SIGNED_IN = { "claude --version": 0, "claude auth status": 0 };

describe("CLAUDE_AREA and CODEX_AREA", () => {
	let fs: FakeFs;
	function machine(programs: Record<string, number>): SetupMachine {
		return {
			fs,
			ps: new CliPs(programs),
			home: HOME,
			device: new FakeSecretStore(),
		};
	}
	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir(HOME, { recursive: true });
	});

	it("reads the sign-in step done only once the CLI answers and is signed in", async () => {
		const status = async (programs: Record<string, number>) =>
			(await new Setup(machine(programs), [CLAUDE_AREA]).read()).areas[0]
				?.steps[0]?.status;

		expect(await status({})).toBe("ready");
		expect(
			await status({ "claude --version": 0, "claude auth status": 1 }),
		).toBe("ready");
		expect(await status(SIGNED_IN)).toBe("done");
	});

	it("tells where to install a CLI that does not answer, and to sign in one that is signed out", async () => {
		const missing = new Setup(machine({}), [CODEX_AREA]);
		const signedOut = new Setup(machine({ "codex --version": 0 }), [
			CODEX_AREA,
		]);

		await expect(missing.submit("codex-signin", {})).rejects.toThrow(
			"Codex is not installed here: install it with npm install --global @openai/codex, then run codex once to sign in.",
		);
		await expect(signedOut.submit("codex-signin", {})).rejects.toThrow(
			"Codex is installed but not signed in: run codex once to sign in.",
		);
	});

	it("creates the roster with just this agent, and refuses no model ticked", async () => {
		const setup = new Setup(
			machine({ "codex --version": 0, "codex login status": 0 }),
			[CODEX_AREA],
		);

		await expect(
			setup.submit("codex-models", {
				"codex-model-gpt-6-astra": false,
				"codex-model-gpt-6-luna": false,
			}),
		).rejects.toThrow("Tick at least one model.");
		await setup.submit("codex-models", {
			"codex-model-gpt-6-astra": false,
			"codex-model-gpt-6-luna": true,
		});

		const saved = JSON.parse(await fs.read(`${HOME}/agents.json`));
		expect(saved.agents).toHaveLength(1);
		expect(saved.agents[0].id).toBe("codex");
		expect(saved.agents[0].models).toHaveLength(1);
	});
});
