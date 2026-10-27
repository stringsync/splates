import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { CLAUDE_AREA, CODEX_AREA, KIMI_AREA } from "./area-native";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";

describe("CLAUDE_AREA and CODEX_AREA", () => {
	let fs: FakeFs;
	function machine(
		programs: ConstructorParameters<typeof CliPs>[0],
	): SetupMachine {
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

	it("finds Kimi off the PATH, and reads it signed in only while its own provider is configured", async () => {
		const status = async (programs: ConstructorParameters<typeof CliPs>[0]) =>
			(await new Setup(machine(programs), [KIMI_AREA]).read()).areas[0]
				?.steps[0]?.status;
		const signedOut = {
			"kimi --version": 0,
			"kimi provider list": {
				exitCode: 0,
				stdout: "No providers configured.\n",
			},
		};

		expect(await status(signedOut)).toBe("ready");
		expect(
			await status({
				"kimi --version": 0,
				"kimi provider list": {
					exitCode: 0,
					stdout: "managed:kimi-code  type=kimi  models=6  source=oauth\n",
				},
			}),
		).toBe("done");
		await expect(
			new Setup(machine(signedOut), [KIMI_AREA]).submit("kimi-signin", {}),
		).rejects.toThrow(
			"Kimi is installed but not signed in: run kimi login once to sign in.",
		);
		await expect(
			new Setup(machine({}), [KIMI_AREA]).submit("kimi-signin", {}),
		).rejects.toThrow(
			"Kimi is not installed here: install it with curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash, then run kimi login once to sign in.",
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
				"codex-model-gpt-6.1-sol": false,
				"codex-model-gpt-6-luna": false,
			}),
		).rejects.toThrow("Tick at least one model.");
		await setup.submit("codex-models", {
			"codex-model-gpt-6-astra": false,
			"codex-model-gpt-6.1-sol": false,
			"codex-model-gpt-6-luna": true,
		});

		const saved = JSON.parse(await fs.read(`${HOME}/agents.json`));
		expect(saved.agents).toHaveLength(1);
		expect(saved.agents[0].id).toBe("codex");
		expect(saved.agents[0].models).toHaveLength(1);
	});

	it("undoes the models by taking just this agent off the roster, leaving the CLI to the person", async () => {
		const programs = {
			...SIGNED_IN,
			"codex --version": 0,
			"codex login status": 0,
		};
		const setup = new Setup(machine(programs), [CLAUDE_AREA, CODEX_AREA]);
		await setup.submit("claude-models", {
			"claude-model-fable": false,
			"claude-model-opus": true,
			"claude-model-sonnet": false,
			"claude-model-haiku": true,
		});
		await setup.submit("codex-models", {
			"codex-model-gpt-6-astra": false,
			"codex-model-gpt-6.1-sol": false,
			"codex-model-gpt-6-luna": true,
		});

		expect((await setup.undoPlan("claude")).steps).toEqual([
			{
				id: "claude-models",
				title: "Choose Claude models",
				done: true,
				removes: [
					`Claude on the roster in \`${HOME}/agents.json\`, running Opus 5.5, Haiku 5.5`,
				],
				leaves: [],
			},
			{
				id: "claude-signin",
				title: "Install and sign in to Claude",
				done: true,
				removes: [],
				leaves: [
					"Claude stays signed in: run `claude auth logout` to sign out.",
					"Claude stays installed: run `rm -f ~/.local/bin/claude && rm -rf ~/.local/share/claude` to remove it.",
				],
			},
		]);
		const progress = await setup.undo("claude", null);

		expect(progress.areas[0]?.steps.map((step) => step.status)).toEqual([
			"done",
			"ready",
		]);
		const saved = JSON.parse(await fs.read(`${HOME}/agents.json`));
		expect(saved.agents.map((agent: { id: string }) => agent.id)).toEqual([
			"codex",
		]);
		await CLAUDE_AREA.steps[1]?.undo?.run(machine(programs));
		expect(JSON.parse(await fs.read(`${HOME}/agents.json`))).toEqual(saved);
	});
});

/**
 * A machine whose CLIs answer as `programs` says: a command's exit code, or
 * its exit code and what it prints, by its words. A command run through
 * `sh -c` goes by the words after the script, its `$0` first.
 */
class CliPs extends FakePs {
	constructor(
		private readonly programs: Record<
			string,
			number | { exitCode: number; stdout: string }
		>,
	) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		const words = argv[0] === "sh" ? argv.slice(3) : argv;
		const answer = this.programs[words.join(" ")] ?? 127;
		return typeof answer === "number"
			? { exitCode: answer, stdout: "", stderr: "" }
			: { ...answer, stderr: "" };
	}
}

const SIGNED_IN = { "claude --version": 0, "claude auth status": 0 };
