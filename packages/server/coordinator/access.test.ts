import { describe, expect, it } from "bun:test";
import type { SpawnOptions } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import {
	accessCommand,
	accessDefinition,
	accessEnvironmentSignsIn,
	pulumiOrg,
	writeAccessEnvironment,
} from "./access";

describe("the ESC sign-in", () => {
	it("is in the default organization", async () => {
		const ps = new PulumiPs({ "pulumi org get-default": "acme\n" });
		expect(await pulumiOrg(ps)).toBe("acme");
	});

	it("is in the user's own organization without a default", async () => {
		const ps = new PulumiPs({
			"pulumi whoami": JSON.stringify({ user: "me" }),
		});
		expect(await pulumiOrg(ps)).toBe("me");
	});

	it("is in none with Pulumi logged out", async () => {
		expect(await pulumiOrg(new PulumiPs({}))).toBeNull();
	});

	it("makes the environment from the definition on stdin", async () => {
		const ps = new PulumiPs({ "pulumi env init": "" });
		await writeAccessEnvironment(ps, "acme", "123456789012");
		expect(ps.getCalls().at(-1)).toBe("pulumi env init acme/splates/aws -f -");
		expect(ps.stdins.at(-1)).toBe(accessDefinition("123456789012"));
		expect(ps.stdins.at(-1)).toContain(
			"roleArn: arn:aws:iam::123456789012:role/splates-pulumi",
		);
	});

	it("rewrites an environment already there", async () => {
		const ps = new PulumiPs({ "pulumi env get": "", "pulumi env edit": "" });
		await writeAccessEnvironment(ps, "acme", "123456789012");
		expect(ps.getCalls().at(-1)).toBe("pulumi env edit acme/splates/aws -f -");
	});

	it("says what Pulumi said when it fails", async () => {
		expect(
			writeAccessEnvironment(new PulumiPs({}), "acme", "123456789012"),
		).rejects.toThrow("no such thing");
	});

	it("is checked as `pulumi up` gets it", async () => {
		const ps = new PulumiPs({ "pulumi env run": "" });
		expect(await accessEnvironmentSignsIn(ps, "acme")).toBe(true);
		expect(ps.getCalls()).toEqual([
			"pulumi env run acme/splates/aws -- aws sts get-caller-identity",
		]);
	});

	it("has CloudShell make the role trusting the organization, then print the account", () => {
		const command = accessCommand("acme");
		expect(command).toContain("--parameter-overrides PulumiOrg=acme");
		expect(command).toContain("--capabilities CAPABILITY_NAMED_IAM");
		expect(command).toEndWith(
			"aws sts get-caller-identity --query Account --output text",
		);
	});
});

/**
 * Pulumi as a test plays it: a command line starting with a key of
 * `answers` prints its value, any other fails; each stdin is kept.
 */
class PulumiPs extends FakePs {
	stdins: (string | undefined)[] = [];

	constructor(private readonly answers: Record<string, string>) {
		super();
	}

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		this.stdins.push(opts?.stdin);
		const line = argv.join(" ");
		const key = Object.keys(this.answers).find((each) => line.startsWith(each));
		return key === undefined
			? { exitCode: 1, stdout: "", stderr: "no such thing" }
			: { exitCode: 0, stdout: this.answers[key] ?? "", stderr: "" };
	}
}
