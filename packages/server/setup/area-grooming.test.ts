import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { HookStore } from "../hooks";
import { GROOMING_AREA } from "./area-grooming";
import { setupProjectAt } from "./project";
import { Setup, type SetupMachine } from "./setup";

const HOME = "/home/.splates";
const ROOT = "/repo";

describe("GROOMING_AREA", () => {
	let machine: SetupMachine;
	let groomed: number;

	beforeEach(async () => {
		const fs = new FakeFs();
		groomed = 0;
		machine = {
			fs,
			home: HOME,
			device: new FakeSecretStore(),
			project: setupProjectAt(ROOT, { fs, ps: new FakePs() }, () => {
				groomed += 1;
			}),
		};
		await fs.mkdir(HOME, { recursive: true });
		await fs.mkdir(`${ROOT}/.git/splates`, { recursive: true });
		await fs.write(
			`${HOME}/agents.json`,
			JSON.stringify({
				agents: [
					{
						id: "claude",
						name: "Claude",
						argv: ["claude-acp"],
						models: [
							{
								id: "opus",
								name: "Opus",
								strengths: "",
								cost: "high",
								costRank: 3,
							},
							{
								id: "sonnet",
								name: "Sonnet",
								strengths: "",
								cost: "low",
								costRank: 2,
							},
						],
					},
				],
			}),
		);
	});

	it("offers each model on the roster, the cheapest first, and turns the groomer on as the one picked", async () => {
		const setup = new Setup(machine, [GROOMING_AREA]);
		const [step] = (await setup.read()).areas[0]?.steps ?? [];
		expect(step?.status).not.toBe("done");
		const [field] = step?.fields ?? [];
		expect(field?.kind === "choice" ? field.options : []).toEqual([
			{ value: "claude/sonnet", label: "Claude Sonnet, low" },
			{ value: "claude/opus", label: "Claude Opus, high" },
		]);

		await setup.submit("groomer", { pick: "claude/sonnet" });

		expect((await setup.read()).areas[0]?.steps[0]?.status).toBe("done");
		expect(groomed).toBe(1);
		const [groomer] = await new HookStore(
			`${ROOT}/.git/splates/hooks.json`,
			machine.fs,
		).read();
		expect(groomer).toMatchObject({
			id: "groomer",
			source: "builtin",
			hook: { kind: "groom", agent: "claude", model: "sonnet" },
		});
	});
});
