import { commaList } from "@stringsync/splates-server/comma-list";
import { fail } from "@stringsync/splates-server/exit";
import { infraInit } from "@stringsync/splates-server/infra/init";
import type { SplatesDeps } from "@stringsync/splates-server/server";
import { cli } from "webappwiz/cmd";
import { z } from "zod";

/** `splates server infra`, which `splates server` mounts. */
export const splatesInfra = cli<SplatesDeps>("infra").description(
	"the Pulumi project that makes everything the server's box needs in AWS, Cloudflare and GitHub, which `splates server deploy` then installs splates on",
);

splatesInfra
	.command("init")
	.description(
		"write a Pulumi project in <dir>, its program a dozen lines using the components of @stringsync/splates-server/infra, and the stack's config from the flags; run again, it writes only what is not so already and keeps values you changed. It prints each id and secret left to set with `pulumi config set`. Then `bun add @stringsync/splates-server @pulumi/pulumi @pulumi/aws @pulumi/awsx @pulumi/cloudflare @pulumi/github @pulumi/tls @pulumi/random` there and `pulumi up`",
	)
	.arg("dir", z.string(), { description: "where the Pulumi project goes" })
	.option("stack", z.string(), { default: "prod", description: "the stack" })
	.option("host", z.string(), {
		description: "the public host name, as in splates.example.com",
	})
	.option("email", z.string(), {
		description: "the email address Access lets in",
	})
	.option("region", z.string(), {
		default: "us-east-1",
		description: "the AWS region",
	})
	.option("projects", z.string(), {
		default: "",
		description:
			"comma-separated slug=owner/repo, each a project the box pushes trunk of",
	})
	.action(async (opts, ctx) => {
		const projects = commaList(opts.projects).map((entry) => {
			const [slug, repository] = entry.split("=");
			if (!slug || !repository?.includes("/")) {
				fail("usage", `--projects wants slug=owner/repo, not ${entry}`, {
					entry,
				});
			}
			return { slug, repository };
		});
		const { written, todo } = await infraInit({
			dir: opts.dir,
			stack: opts.stack,
			host: opts.host,
			email: opts.email,
			region: opts.region,
			projects,
			fs: ctx.fs,
		});
		ctx.log.info(
			written.length === 0
				? "already so: nothing written"
				: `wrote ${written.join(", ")}`,
		);
		for (const command of todo) {
			ctx.log.info(`still to run in ${opts.dir}: ${command}`);
		}
	});
