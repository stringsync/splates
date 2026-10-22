import * as aws from "@pulumi/aws";
import * as github from "@pulumi/github";
import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import { envSecret } from "./env";
import { githubTokenCred, ownerOf } from "./init";

/** A project the box clones and pushes trunk of. */
export interface DeployKeyProject {
	/** The project's name, which its creds are kept under. */
	slug: string;
	/** The GitHub owner and repository, as `owner/repo`. */
	repository: string;
}

export interface DeployKeysArgs {
	projects: DeployKeyProject[];
}

/** Where a project's deploy key is kept, as the box's per-project SSM store reads it. */
export function deployKeyParameter(slug: string): string {
	return `/splates/projects/${slug}/SPLATES_DEPLOY_KEY`;
}

/**
 * A deploy key with write access on GitHub per project, its private half in
 * a `SecureString` parameter, so the box clones and pushes without anyone
 * adding a key by hand.
 */
export class DeployKeys extends pulumi.ComponentResource {
	/** Each project's parameter name, by slug. */
	readonly parameters: Record<string, string>;

	constructor(
		name: string,
		args: DeployKeysArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("splates:infra:DeployKeys", name, {}, opts);
		const child = { parent: this };
		this.parameters = {};
		// The resource takes a repository name alone, so each owner gets its own provider, with its own token.
		const providers = new Map<string, github.Provider>();
		for (const { slug, repository } of args.projects) {
			const key = new tls.PrivateKey(
				`${name}-${slug}-key`,
				{ algorithm: "ED25519" },
				child,
			);
			const owner = ownerOf(repository);
			const repo = repository.slice(owner.length + 1);
			let provider = providers.get(owner);
			if (!provider) {
				provider = new github.Provider(
					`${name}-${owner}`,
					{
						owner,
						token: envSecret(githubTokenCred(owner)),
					},
					child,
				);
				providers.set(owner, provider);
			}
			new github.RepositoryDeployKey(
				`${name}-${slug}`,
				{
					repository: repo,
					title: `splates coordinator ${slug}`,
					key: key.publicKeyOpenssh,
					readOnly: false,
				},
				{ ...child, provider },
			);
			const parameter = deployKeyParameter(slug);
			new aws.ssm.Parameter(
				`${name}-${slug}-parameter`,
				{
					name: parameter,
					type: "SecureString",
					value: pulumi.secret(key.privateKeyOpenssh),
				},
				child,
			);
			this.parameters[slug] = parameter;
		}
		this.registerOutputs({ parameters: this.parameters });
	}
}
