import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { writeInfraConfig } from "../coordinator";
import { SECRET_PLACEHOLDER } from "../infra/secrets";
import { stackSecretsStep } from "./coordinator-secrets";
import type { SetupMachine, SetupStep } from "./setup";

/** Pulumi logged in to `me`, its secrets environment's definition whatever `definition` holds. */
class EscPs extends FakePs {
	definition: string | null = null;
	readonly asked: string[][] = [];

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		this.asked.push(argv);
		const asks = argv.join(" ");
		if (asks === "pulumi org get-default") {
			return { exitCode: 0, stdout: "me\n", stderr: "" };
		}
		if (asks.startsWith("pulumi env get me/splates/secrets")) {
			return this.definition === null
				? { exitCode: 255, stdout: "", stderr: "[404] Not Found" }
				: { exitCode: 0, stdout: this.definition, stderr: "" };
		}
		return { exitCode: 1, stdout: "", stderr: "" };
	}
}

describe("stackSecretsStep", () => {
	const infra = {
		id: "coordinator-infra",
		after: [],
	} as unknown as SetupStep;
	const step = stackSecretsStep(infra, async () => null);
	let fs: FakeFs;
	let ps: EscPs;
	let machine: SetupMachine;

	beforeEach(async () => {
		fs = new FakeFs();
		ps = new EscPs();
		machine = { fs, ps, home: "/home/.splates", device: new FakeSecretStore() };
		await writeInfraConfig(fs, machine.home, { dir: "/infra", stack: "prod" });
		await fs.write(
			"/infra/Pulumi.prod.yaml",
			"config:\n  splates:projects:\n    - slug: app\n      repository: acme/app\n    - slug: lib\n      repository: My-Name/lib\n",
		);
	});

	const definition = (set: Record<string, boolean>) =>
		`values:\n  pulumiConfig:\n${Object.entries(set)
			.map(([key, done]) =>
				done
					? `    ${key}:\n      fn::secret:\n        ciphertext: ZXNjeAAA`
					: `    ${key}: ${SECRET_PLACEHOLDER}`,
			)
			.join("\n")}\n`;

	it("stands for a step per secret, one per owner, each saying how to get it and linking to Pulumi", async () => {
		const each = (await step.each?.(machine)) ?? [];

		expect(each.map((one) => one.id)).toEqual([
			"coordinator-secret-cloudflare",
			"coordinator-secret-github-acme",
			"coordinator-secret-github-my-name",
			"coordinator-secret-anthropic",
		]);
		expect(each.every((one) => one.of === step && one.after[0] === infra)).toBe(
			true,
		);
		const github = each[2] as SetupStep;
		expect(github.title).toBe("Paste the GitHub token for My-Name into Pulumi");
		expect(github.user).toContain("`My-Name/lib`");
		expect(github.user).toContain(
			"(https://app.pulumi.com/me/esc/splates/secrets)",
		);
		expect(each[0]?.user).toContain("Zone · DNS · Edit");
	});

	it("reads a secret done once Pulumi holds anything but its placeholder, never asking for the value", async () => {
		ps.definition = definition({
			"cloudflare:apiToken": true,
			"splates:githubToken-acme": false,
			"splates:githubToken-My-Name": true,
			"splates:anthropicKey": true,
		});

		const each = (await step.each?.(machine)) ?? [];
		const done = await Promise.all(each.map((one) => one.check(machine)));

		expect(done).toEqual([true, false, true, true]);
		expect(await step.check(machine)).toBe(false);
		expect(ps.asked.some((argv) => argv.includes("--show-secrets"))).toBe(
			false,
		);
	});

	it("is done once every secret is pasted", async () => {
		ps.definition = definition({
			"cloudflare:apiToken": true,
			"splates:githubToken-acme": true,
			"splates:githubToken-My-Name": true,
			"splates:anthropicKey": true,
		});

		expect(await step.check(machine)).toBe(true);
	});

	it("says the environment is not made yet before the infra project makes it", async () => {
		const each = (await step.each?.(machine)) ?? [];

		expect(await each[0]?.check(machine)).toBe(false);
		expect(await each[0]?.detail?.(machine)).toContain(
			"not on the Pulumi site yet",
		);
	});
});
