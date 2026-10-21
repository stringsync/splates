import { describe, expect, it } from "bun:test";
import { accessCommand } from "../coordinator";
import { parameterPolicy, workerPolicy } from "./coordinator-box";

describe("the access template", () => {
	it("is the template CloudShell fetches", () => {
		expect(accessCommand("acme")).toContain(
			"/main/packages/server/infra/pulumi-access.yaml",
		);
	});

	it("trusts only the organization's ESC environments, an hour at a time", async () => {
		const { Resources } = await template();
		const role = Resources.Role.Properties;
		expect(Resources.PulumiOidc.Properties.Url).toBe(
			"https://api.pulumi.com/oidc",
		);
		expect(role.RoleName).toBe("splates-pulumi");
		expect(role.MaxSessionDuration).toBe(3600);
		expect(role.AssumeRolePolicyDocument.Statement).toEqual([
			expect.objectContaining({
				Action: "sts:AssumeRoleWithWebIdentity",
				Condition: {
					StringEquals: {
						"api.pulumi.com/oidc:aud": { "Fn::Sub": `aws:${ORG}` },
					},
					StringLike: {
						"api.pulumi.com/oidc:sub": {
							"Fn::Sub": `pulumi:environments:org:${ORG}:env:*`,
						},
					},
				},
			}),
		]);
	});

	it("allows what the box's own role and the workers' do", async () => {
		const own = [parameterPolicy(), workerPolicy("w", "b")].flatMap((policy) =>
			(JSON.parse(policy).Statement as Statement[]).flatMap((each) =>
				[each.Action].flat(),
			),
		);
		const allowed = await allowedActions();
		expect(own.filter((action) => !allows(allowed, action))).toEqual([]);
	});

	it("allows making what the stack makes and reading the box's console, and nothing else", async () => {
		const allowed = await allowedActions();
		const wanted = [
			"ec2:CreateVpc",
			"ec2:CreateSubnet",
			"ec2:CreateInternetGateway",
			"ec2:CreateRouteTable",
			"ec2:RunInstances",
			"ec2:GetConsoleOutput",
			"iam:CreateRole",
			"iam:PutRolePolicy",
			"iam:CreateInstanceProfile",
			"dlm:CreateLifecyclePolicy",
			"ssm:PutParameter",
		];
		expect(wanted.filter((action) => !allows(allowed, action))).toEqual([]);
		expect(
			["iam:CreateUser", "s3:GetObject"].filter((action) =>
				allows(allowed, action),
			),
		).toEqual([]);
	});

	it("keeps IAM to the stack's own names", async () => {
		const iam = (await statements()).find((each) =>
			[each.Action].flat().includes("iam:CreateRole"),
		);
		expect(iam?.Resource).toEqual([
			{ "Fn::Sub": `arn:aws:iam::${ACCOUNT}:role/splates-*` },
			{
				"Fn::Sub": `arn:aws:iam::${ACCOUNT}:role/AWSDataLifecycleManagerDefaultRole`,
			},
			{
				"Fn::Sub": `arn:aws:iam::${ACCOUNT}:instance-profile/splates-*`,
			},
		]);
	});
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation's own placeholder for the parameter.
const ORG = "${PulumiOrg}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation's own placeholder for the account.
const ACCOUNT = "${AWS::AccountId}";

interface Statement {
	Action: string | string[];
	Resource: unknown;
}

/** The template as CloudFormation reads it. */
// biome-ignore lint/suspicious/noExplicitAny: a template is whatever YAML it holds.
async function template(): Promise<{ Resources: Record<string, any> }> {
	return Bun.YAML.parse(
		await Bun.file(new URL("./pulumi-access.yaml", import.meta.url)).text(),
	) as { Resources: Record<string, unknown> };
}

async function statements(): Promise<Statement[]> {
	return (await template()).Resources.Role.Properties.Policies[0].PolicyDocument
		.Statement;
}

async function allowedActions(): Promise<string[]> {
	return (await statements()).flatMap((each) => [each.Action].flat());
}

/** Whether `allowed` lets `action` through, wildcards and all. */
function allows(allowed: string[], action: string): boolean {
	return allowed.some((each) =>
		each.endsWith("*") ? action.startsWith(each.slice(0, -1)) : each === action,
	);
}
