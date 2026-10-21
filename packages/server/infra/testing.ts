import * as pulumi from "@pulumi/pulumi";

interface Made {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
}

/**
 * Mocks pulumi's engine, which must happen before the components import, and
 * returns how to find what they registered.
 */
export function mockPulumi(): (type: string) => Promise<Made[]> {
	const made: Made[] = [];
	pulumi.runtime.setMocks({
		newResource: (args) => {
			made.push({ type: args.type, name: args.name, inputs: args.inputs });
			const state =
				args.type === "awsx:ec2:Vpc"
					? { ...args.inputs, vpcId: "vpc-1", publicSubnetIds: ["subnet-1"] }
					: args.type === "aws:ec2/keyPair:KeyPair"
						? { ...args.inputs, keyName: args.name }
						: args.inputs;
			return { id: `${args.name}-id`, state };
		},
		call: (args) =>
			args.token === "aws:ec2/getAmi:getAmi" ? { id: "ami-1" } : args.inputs,
	});
	// Resources register as the engine gets to them, so wait for the first of a type.
	return async (type) => {
		for (let tries = 0; tries < 100; tries++) {
			const found = made.filter((resource) => resource.type === type);
			if (found.length > 0) {
				return found;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		return [];
	};
}
