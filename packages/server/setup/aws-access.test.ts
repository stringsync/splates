import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import type { SpawnOptions } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { writeInfraConfig } from "../coordinator";
import { awsAccessStep } from "./aws-access";
import type { SetupMachine } from "./setup";

const HOME = "/home/.splates";

describe("the AWS access step", () => {
	const step = awsAccessStep([]);
	let fs: FakeFs;
	let ps: EscPs;
	let machine: SetupMachine;

	beforeEach(() => {
		fs = new FakeFs();
		ps = new EscPs();
		machine = { fs, ps, home: HOME, device: new FakeSecretStore() };
	});

	it("hands the page CloudShell's line for the organization", async () => {
		expect(await step.data?.(machine)).toMatchObject({
			environment: "acme/splates/aws",
			command: expect.stringContaining("PulumiOrg=acme"),
		});
	});

	it("is not done until the ESC environment signs in", async () => {
		expect(await step.check(machine)).toBe(false);
		await step.submit?.(machine, { account: "123456789012" });
		expect(await step.check(machine)).toBe(false);
		ps.signsIn = true;
		expect(await step.check(machine)).toBe(true);
	});

	it("makes the environment and has the infra stack import it", async () => {
		await writeInfraConfig(fs, HOME, { dir: "/code/infra", stack: "prod" });
		await fs.write(
			"/code/infra/Pulumi.prod.yaml",
			"config:\n  aws:region: us-east-1\n",
		);
		await step.submit?.(machine, { account: "123456789012" });
		expect(ps.getCalls()).toContain("pulumi env init acme/splates/aws -f -");
		expect(
			Bun.YAML.parse(await fs.read("/code/infra/Pulumi.prod.yaml")),
		).toEqual({
			config: { "aws:region": "us-east-1" },
			environment: ["splates/aws"],
		});
	});

	it("refuses an account id that is not one", async () => {
		expect(step.submit?.(machine, { account: "acme" })).rejects.toThrow(
			"12 digits",
		);
	});

	it("leaves an AWS profile to the check when no id is given", async () => {
		await step.submit?.(machine, { account: "" });
		expect(ps.getCalls()).toEqual([]);
	});

	it("warns when a profile of the root user signs in instead of ESC", async () => {
		ps.caller = "arn:aws:iam::123456789012:root";
		expect(await step.warning?.(machine)).toContain("root user's access key");
	});

	it("names the profile that signs in instead of ESC", async () => {
		ps.caller = "arn:aws:iam::123456789012:user/deploy";
		expect(await step.warning?.(machine)).toContain(
			"as `arn:aws:iam::123456789012:user/deploy`",
		);
	});

	it("says nothing once ESC signs in, or when nothing does", async () => {
		expect(await step.warning?.(machine)).toBeNull();
		ps.caller = "arn:aws:iam::123456789012:root";
		await step.submit?.(machine, { account: "123456789012" });
		ps.signsIn = true;
		expect(await step.warning?.(machine)).toBeNull();
	});
});

/** Pulumi logged in to `acme`, the ESC environment there once made, AWS taking its sign-in, and the AWS CLI's own profile signing in as `caller`. */
class EscPs extends FakePs {
	environment = false;
	signsIn = false;
	caller: string | null = null;

	override async spawnCapture(argv: string[], opts?: SpawnOptions) {
		await super.spawnCapture(argv, opts);
		const line = argv.join(" ");
		const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
		const no = { exitCode: 1, stdout: "", stderr: "no" };
		if (line === "pulumi org get-default") {
			return ok("acme\n");
		}
		if (line.startsWith("pulumi env get")) {
			return this.environment ? ok() : no;
		}
		if (line.startsWith("pulumi env init")) {
			this.environment = true;
			return ok();
		}
		if (line === "aws sts get-caller-identity --output json") {
			return this.caller === null
				? no
				: ok(JSON.stringify({ Arn: this.caller }));
		}
		if (line.startsWith("pulumi env run")) {
			return this.environment && this.signsIn ? ok() : no;
		}
		return no;
	}
}
