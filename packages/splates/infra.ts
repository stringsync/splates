import { resolve } from "node:path";
import { commaList } from "@stringsync/splates-server/comma-list";
import {
	ACCESS_ENVIRONMENT,
	accessEnvironmentExists,
	CoordinatorBox,
	pulumiOrg,
	writeInfraConfig,
} from "@stringsync/splates-server/coordinator";
import { fail } from "@stringsync/splates-server/exit";
import { infraConfigure } from "@stringsync/splates-server/infra/configure";
import { secretsEnvironmentUrl } from "@stringsync/splates-server/infra/secrets";
import { Projects } from "@stringsync/splates-server/projects";
import { repository } from "@stringsync/splates-server/records";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { savedTunnelOf } from "@stringsync/splates-server/server";
import { FsStorage } from "@stringsync/splates-server/storage";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates server infra`, which `splates server` mounts. */
export const splatesInfra = cli<SplatesDeps>("infra").description(
	"the Pulumi project that makes everything the server's box needs in AWS, Cloudflare and GitHub, which `splates server deploy` then installs splates on",
);

splatesInfra
	.command("init")
	.use(repository({ needs: "own" }))
	.description(
		"write a Pulumi project in <dir>, its program a dozen lines using the components of @stringsync/splates-server/infra, and the stack's config from the flags; run again, it writes only what is not so already and keeps values you changed. It fills the stack's config from what splates keeps (the projects, the saved tunnel, the Cloudflare ids). The secrets never pass through splates: it makes the Pulumi ESC environment splates/secrets with a placeholder for each (the Cloudflare token, a GitHub token per owner, the Anthropic key), which the stack imports and the user replaces on the Pulumi site; `splates setup` has a step for each saying how to get it. When the Pulumi ESC environment `coordinator-access` makes (splates/aws) is there, the stack imports it. It records the directory in ~/.splates/coordinator/infra.json, where `splates server deploy` finds the stack. Its runtime is bun, which runs the program's TypeScript itself. Commit the project but not Pulumi.<stack>.yaml, which holds your own accounts and ids and which the .gitignore it writes keeps out of git; init writes it again from what splates keeps. Then `bun add @stringsync/splates-server @pulumi/pulumi @pulumi/aws @pulumi/awsx @pulumi/cloudflare @pulumi/github @pulumi/tls @pulumi/random` there and `pulumi up`",
	)
	.arg("dir", z.string(), { description: "where the Pulumi project goes" })
	.option("stack", z.string(), { default: "prod", description: "the stack" })
	.option("host", z.string(), {
		default: "",
		description:
			"the public host name, as in splates.example.com; the saved tunnel's by default",
	})
	.option("email", z.string(), {
		default: "",
		description:
			"the email address Access lets in; the tunnel's Access application's by default",
	})
	.option("region", z.string(), {
		default: "us-east-1",
		description: "the AWS region",
	})
	.option("projects", z.string(), {
		default: "",
		description:
			"comma-separated slug=owner/repo, each a project the box pushes trunk of; every project registered here with a GitHub origin by default",
	})
	.action(async (opts, ctx) => {
		const listed = commaList(opts.projects).map((entry) => {
			const [slug, repository] = entry.split("=");
			if (!slug || !repository?.includes("/")) {
				fail("usage", `--projects wants slug=owner/repo, not ${entry}`, {
					entry,
				});
			}
			return { slug, repository };
		});
		const org = await pulumiOrg(ctx.ps);
		const home = new CoordinatorBox({ ps: ctx.ps, fs: ctx.fs }).home;
		const { written, todo } = await infraConfigure({
			dir: opts.dir,
			stack: opts.stack,
			host: opts.host,
			email: opts.email,
			region: opts.region,
			projects: listed.length === 0 ? null : listed,
			registered: async () =>
				(await Projects.in(new FsStorage(home, ctx.fs), ctx.fs).list()).filter(
					(project) => !project.gone,
				),
			creds: ctx.creds,
			saved: savedTunnelOf(ctx),
			// The sign-in `coordinator-access` made, once it is there.
			...(org !== null && (await accessEnvironmentExists(ctx.ps, org))
				? { environment: ACCESS_ENVIRONMENT }
				: {}),
			fs: ctx.fs,
			ps: ctx.ps,
			log: ctx.log,
			fetch: ctx.fetch,
		});
		await writeInfraConfig(ctx.fs, home, {
			dir: resolve(opts.dir),
			stack: opts.stack,
		});
		ctx.log.info(
			written.length === 0
				? "already so: nothing written"
				: `wrote ${written.join(", ")}`,
		);
		ctx.log.info(
			`Pulumi.${opts.stack}.yaml stays out of git: it holds your own accounts and ids, and init writes it again from what splates keeps`,
		);
		for (const command of todo) {
			ctx.log.info(`still to run in ${opts.dir}: ${command}`);
		}
		if (org !== null) {
			ctx.log.info(
				`paste each secret over its placeholder at ${secretsEnvironmentUrl(org)}: \`splates setup\` has a step for each saying how to get it`,
			);
		}
	});
