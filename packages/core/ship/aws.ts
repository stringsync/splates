import type { Ctx } from "./ctx";
import { type Step, step } from "./step";

/** A stack of a CDK app, as the CDK CLI names it. */
export interface Stack {
	/** The stack's id in its app, as `cdk deploy` takes it (`Staging/Network`). */
	readonly name: string;
	/** The folder holding the app's `cdk.json`, from where the ship runs. */
	readonly app: string;
}

export interface DeployOptions {
	/**
	 * The AWS profile the stack deploys with. A profile signed in through
	 * SSO is signed in again when its session has lapsed; left out, the
	 * credentials come from the environment and there is no sign-in step.
	 */
	readonly profile?: string;
	/** Steps of the same target that finish before the first of these. */
	readonly dependencies?: readonly string[];
	/**
	 * Extra CDK arguments (`--context key=value`) for the diff and the deploy,
	 * read when each runs so they can come from live state. The same
	 * arguments reach both, so the deploy's done check diffs what it deploys.
	 */
	readonly context?: (ctx: Pick<Ctx, "sh">) => Promise<readonly string[]>;
	/**
	 * Deploy with `--no-rollback`, so a failed deploy stays for a retry. A
	 * change that replaces a resource (cheap, or costly and confirmed by the
	 * diff step) deploys with rollback on, which CloudFormation requires.
	 */
	readonly noRollback?: boolean;
	/**
	 * CloudFormation types whose replacement is cheap: it asks no confirm, and
	 * with `noRollback` keeps rollback on. Defaults to
	 * `AWS::ECS::TaskDefinition` when `noRollback` is set, else none.
	 */
	readonly cheapReplacement?: readonly string[];
}

/** What `cdk diff` said about a stack. */
export interface Diff {
	/** Whether the deployed stack already matches the app. */
	readonly same: boolean;
	/** Whether the change adds IAM or security group rules. */
	readonly widens: boolean;
	/** The resources the change replaces, by logical id where it names one. */
	readonly replaces: readonly string[];
	/** The CloudFormation type of each replaced resource, in the same order. */
	readonly replacedTypes: readonly string[];
}

/**
 * The steps of deploying `stack`: sign in, diff, deploy and verify. The diff
 * asks the user to confirm a change that widens access or replaces
 * resources, and the deploy is skipped when the stack already matches this
 * checkout, so a resumed run deploys nothing twice.
 */
export function deploy(stack: Stack, opts: DeployOptions = {}): Step[] {
	const { profile, noRollback = false } = opts;
	const cheap = opts.cheapReplacement ?? (noRollback ? CHEAP : []);
	const cdk = async (
		ctx: Pick<Ctx, "sh">,
		verb: string,
		args = "",
	): Promise<string> => {
		const extra = (await opts.context?.(ctx)) ?? [];
		return `cd ${quote(stack.app)} && bunx aws-cdk@2 ${verb} ${quote(stack.name)}${args}${extra
			.map((arg) => ` ${quote(arg)}`)
			.join(
				"",
			)}${profile ? ` --profile ${quote(profile)}` : ""} --no-color 2>&1`;
	};
	const diff = async (ctx: Ctx, args = "") =>
		parseDiff(await ctx.sh(await cdk(ctx, "diff", args)));
	// CloudFormation refuses `--no-rollback` for a replacement, cheap or a
	// costly one the diff step already had confirmed.
	const replaces = (found: Diff) => found.replacedTypes.length > 0;

	const signIn =
		profile &&
		step({
			id: "sign-in",
			does: `Sign in to AWS as ${profile}`,
			dependencies: opts.dependencies,
			done: async (ctx) =>
				(
					await ctx.sh(
						`aws sts get-caller-identity --profile ${quote(profile)} >/dev/null 2>&1 && echo signed-in || true`,
					)
				).includes("signed-in"),
			run: async (ctx) => {
				await ctx.sh(
					`aws sso login --profile ${quote(profile)} --use-device-code --no-browser`,
					{ prompts: true },
				);
				ctx.update(`Signed in as ${profile}`);
			},
		});

	return [
		...(signIn ? [signIn] : []),
		step({
			id: "diff",
			does: `Show what deploying ${stack.name} changes`,
			dependencies: signIn ? ["sign-in"] : opts.dependencies,
			run: async (ctx) => {
				const found = await diff(ctx);
				if (found.same) {
					ctx.update(`${stack.name} has no changes`);
					return;
				}
				const security = await diff(ctx, " --security-only");
				const risks = describeRisks(
					{ ...found, widens: found.widens || security.widens },
					cheap,
				);
				if (
					risks &&
					!(await ctx.confirm(`Deploy ${stack.name}? The change ${risks}.`))
				) {
					throw new Error(`Not deploying ${stack.name}: the change ${risks}`);
				}
				ctx.update(
					risks ? `${stack.name} ${risks}` : `${stack.name} has changes`,
				);
			},
		}),
		step({
			id: "deploy",
			does: `Deploy ${stack.name}`,
			dependencies: ["diff"],
			done: async (ctx) => (await diff(ctx)).same,
			run: async (ctx) => {
				const keepRollback = !noRollback || replaces(await diff(ctx));
				await ctx.sh(
					await cdk(
						ctx,
						"deploy",
						` --require-approval never${keepRollback ? "" : " --no-rollback"}`,
					),
				);
				ctx.update(`Deployed ${stack.name}`);
			},
		}),
		step({
			id: "verify",
			does: `Check ${stack.name} matches this checkout`,
			dependencies: ["deploy"],
			run: async (ctx) => {
				if (!(await diff(ctx)).same) {
					throw new Error(
						`${stack.name} still differs from this checkout after its deploy`,
					);
				}
				ctx.update(`${stack.name} is at this checkout`);
			},
		}),
	];
}

const CHEAP = ["AWS::ECS::TaskDefinition"];

/** Reads what `cdk diff --no-color` printed for one stack. */
export function parseDiff(output: string): Diff {
	const same =
		/There were no differences|Number of stacks with differences: 0/.test(
			output,
		);
	const widens =
		/IAM Statement Changes|IAM Policy Changes|Security Group Changes/.test(
			output,
		);
	const replaces: string[] = [];
	const replacedTypes: string[] = [];
	let unnamed = false;
	for (const line of output.split("\n")) {
		const resource = line.match(
			/\[[~+-]\]\s+(AWS::\S+)\s+\S+\s+(\S+)\s+(?:replace|may be replaced)\s*$/,
		);
		if (resource?.[1] && resource[2]) {
			replacedTypes.push(resource[1]);
			replaces.push(resource[2]);
		} else if (/requires replacement|may cause replacement/.test(line)) {
			unnamed = true;
		}
	}
	if (unnamed && replaces.length === 0) {
		replaces.push("a resource");
		replacedTypes.push("unknown");
	}
	return { same, widens, replaces, replacedTypes };
}

/** What the confirm says about a diff, or nothing when it is safe. */
function describeRisks(
	diff: Diff,
	cheap: readonly string[],
): string | undefined {
	const costly = diff.replaces.filter(
		(_, i) => !cheap.includes(diff.replacedTypes[i] ?? ""),
	);
	const parts = [
		diff.widens && "widens access",
		costly.length > 0 && `replaces ${costly.join(", ")}`,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" and ") : undefined;
}

function quote(word: string): string {
	return /^[\w@%+=:,./-]+$/.test(word)
		? word
		: `'${word.replaceAll("'", `'\\''`)}'`;
}
