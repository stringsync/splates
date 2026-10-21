import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

export interface CoordinatorBoxArgs {
	/** The box's public host name, which `splates server deploy` serves through the tunnel. */
	host: pulumi.Input<string>;
	/**
	 * The device's creds, as `SecureString` parameters under `/splates/device/`
	 * where the box's SSM secret store reads them, such as the tunnel token and
	 * the Anthropic key workers use. Each value is kept as a Pulumi secret.
	 */
	secrets?: Record<string, pulumi.Input<string>>;
	/** Defaults to `t3.medium`. */
	instanceType?: string;
	/** The root volume's size in GiB; defaults to 50. */
	diskGb?: number;
	/** Who may SSH in, as CIDR blocks; defaults to anyone, which the key alone guards. */
	sshFrom?: string[];
	/** How many daily root-volume snapshots to keep; defaults to 7. */
	snapshots?: number;
}

/** The SSM policy of the box's creds, which the `SsmSecretStore` documents. */
export function parameterPolicy(): string {
	return JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: [
					"ssm:GetParameter",
					"ssm:GetParametersByPath",
					"ssm:PutParameter",
					"ssm:DeleteParameter",
				],
				Resource: "arn:aws:ssm:*:*:parameter/splates/*",
			},
			{ Effect: "Allow", Action: "kms:Decrypt", Resource: "*" },
		],
	});
}

/** What the box needs to make and remove the workers `AwsCloud` runs, and to hand them a role. */
export function workerPolicy(workerProfileArn: string): string {
	return JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: [
					"ec2:RunInstances",
					"ec2:TerminateInstances",
					"ec2:DescribeInstances",
					"ec2:DescribeImages",
					"ec2:DescribeSubnets",
					"ec2:DescribeSecurityGroups",
					"ec2:CreateTags",
				],
				Resource: "*",
			},
			{ Effect: "Allow", Action: "iam:PassRole", Resource: "*" },
			{
				Effect: "Allow",
				Action: "iam:GetInstanceProfile",
				Resource: workerProfileArn,
			},
		],
	});
}

const ASSUME_EC2 = JSON.stringify({
	Version: "2012-10-17",
	Statement: [
		{
			Effect: "Allow",
			Principal: { Service: "ec2.amazonaws.com" },
			Action: "sts:AssumeRole",
		},
	],
});

/**
 * Everything the coordinator's EC2 box needs in AWS: a one-subnet VPC with
 * no NAT gateway, a `t3.medium` with a public IPv4 that only SSH reaches, a
 * role that reads its creds from Parameter Store and makes workers, daily
 * snapshots, and the creds' parameters. `splates server deploy` then installs
 * splates on it and starts it.
 */
export class CoordinatorBox extends pulumi.ComponentResource {
	readonly instanceId: pulumi.Output<string>;
	readonly ipv4: pulumi.Output<string>;
	readonly roleName: pulumi.Output<string>;
	readonly host: pulumi.Output<string>;
	readonly workerProfileName: pulumi.Output<string>;

	constructor(
		name: string,
		args: CoordinatorBoxArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("splates:infra:CoordinatorBox", name, {}, opts);
		const child = { parent: this };

		const vpc = new awsx.ec2.Vpc(
			`${name}-vpc`,
			{
				numberOfAvailabilityZones: 1,
				natGateways: { strategy: awsx.ec2.NatGatewayStrategy.None },
				subnetSpecs: [{ type: awsx.ec2.SubnetType.Public }],
			},
			child,
		);

		const group = new aws.ec2.SecurityGroup(
			`${name}-ssh`,
			{
				vpcId: vpc.vpcId,
				description: "SSH in, anything out",
				ingress: [
					{
						protocol: "tcp",
						fromPort: 22,
						toPort: 22,
						cidrBlocks: args.sshFrom ?? ["0.0.0.0/0"],
					},
				],
				egress: [
					{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
				],
			},
			child,
		);

		const role = new aws.iam.Role(
			`${name}-role`,
			{ assumeRolePolicy: ASSUME_EC2 },
			child,
		);
		new aws.iam.RolePolicy(
			`${name}-parameters`,
			{ role: role.name, policy: parameterPolicy() },
			child,
		);

		// Workers get nothing beyond reading their own parameters.
		const workerRole = new aws.iam.Role(
			`${name}-worker-role`,
			{ assumeRolePolicy: ASSUME_EC2 },
			child,
		);
		const workerProfile = new aws.iam.InstanceProfile(
			`${name}-worker-profile`,
			{ role: workerRole.name },
			child,
		);
		new aws.iam.RolePolicy(
			`${name}-worker`,
			{
				role: role.name,
				policy: workerProfile.arn.apply(workerPolicy),
			},
			child,
		);

		const profile = new aws.iam.InstanceProfile(
			`${name}-profile`,
			{ role: role.name },
			child,
		);

		const image = aws.ec2.getAmiOutput({
			owners: ["099720109477"],
			mostRecent: true,
			filters: [
				{
					name: "name",
					values: [
						"ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*",
					],
				},
			],
		});

		const instance = new aws.ec2.Instance(
			`${name}-instance`,
			{
				ami: image.id,
				instanceType: args.instanceType ?? "t3.medium",
				subnetId: vpc.publicSubnetIds.apply((ids) => ids[0] as string),
				vpcSecurityGroupIds: [group.id],
				iamInstanceProfile: profile.name,
				associatePublicIpAddress: true,
				disableApiTermination: true,
				rootBlockDevice: { volumeType: "gp3", volumeSize: args.diskGb ?? 50 },
				metadataOptions: {
					httpTokens: "required",
					httpPutResponseHopLimit: 1,
					httpEndpoint: "enabled",
				},
				tags: { Name: name, "splates:snapshot": name },
			},
			child,
		);

		const lifecycleRole = new aws.iam.Role(
			`${name}-snapshots-role`,
			{
				assumeRolePolicy: JSON.stringify({
					Version: "2012-10-17",
					Statement: [
						{
							Effect: "Allow",
							Principal: { Service: "dlm.amazonaws.com" },
							Action: "sts:AssumeRole",
						},
					],
				}),
				managedPolicyArns: [
					"arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole",
				],
			},
			child,
		);
		new aws.dlm.LifecyclePolicy(
			`${name}-snapshots`,
			{
				description: "Daily snapshots of the coordinator's root volume",
				executionRoleArn: lifecycleRole.arn,
				state: "ENABLED",
				policyDetails: {
					resourceTypes: ["INSTANCE"],
					targetTags: { "splates:snapshot": name },
					schedules: [
						{
							name: "daily",
							createRule: {
								interval: 24,
								intervalUnit: "HOURS",
								times: "05:00",
							},
							retainRule: { count: args.snapshots ?? 7 },
							copyTags: true,
						},
					],
				},
			},
			child,
		);

		for (const [key, value] of Object.entries(args.secrets ?? {})) {
			new aws.ssm.Parameter(
				`${name}-secret-${key}`,
				{
					name: `/splates/device/${key}`,
					type: "SecureString",
					value: pulumi.secret(value),
				},
				child,
			);
		}

		this.instanceId = instance.id;
		this.ipv4 = instance.publicIp;
		this.roleName = role.name;
		this.host = pulumi.output(args.host);
		this.workerProfileName = workerProfile.name;
		this.registerOutputs({
			instanceId: this.instanceId,
			ipv4: this.ipv4,
			roleName: this.roleName,
			host: this.host,
			workerProfileName: this.workerProfileName,
		});
	}
}
