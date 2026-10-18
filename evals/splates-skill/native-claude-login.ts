import { mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NativeRequest } from "./native-adapter";
import { fixtureWriteRoots, inside } from "./native-codex-roots";

/** Native Keychain identity; never credentials. */
export interface ClaudeLogin {
	home: string;
	user: string;
}

/** Protect every native invocation, including its file tools and descendants. */
export async function claudeLoginEnvironment(
	request: NativeRequest,
	login: ClaudeLogin,
) {
	if (process.platform !== "darwin") {
		throw new Error(
			"Existing Claude login with write isolation requires macOS",
		);
	}
	const { context } = request;
	const repository = await realpath(context.isolation.repository);
	const run = await realpath(dirname(repository));
	if (repository !== join(run, "repo")) {
		throw new Error("Claude repository must belong to an isolated run");
	}
	const privateHome = await realpath(context.env.HOME ?? "");
	const temporary = await realpath(context.env.TMPDIR ?? "");
	const splatesHome = await realpath(context.isolation.splatesHome);
	if (
		privateHome !== join(run, "home") ||
		temporary !== join(run, "tmp") ||
		splatesHome !== join(run, "splates-home")
	) {
		throw new Error("Claude writable directories escape the isolated run");
	}
	const home = await realpath(login.home);
	if (!login.user || inside(home, run) || inside(run, home)) {
		throw new Error("Claude login home must be separate from the isolated run");
	}
	const config = join(privateHome, ".claude");
	await mkdir(config, { recursive: true });
	if ((await realpath(config)) !== config) {
		throw new Error("Claude config directory escapes the private home");
	}
	const roots = [repository, privateHome, temporary, splatesHome];
	if (context.runtime.decisionPath !== undefined) {
		roots.push(...(await fixtureWriteRoots(context)));
	}
	const writes = [...new Set(roots)];
	// Inline profile cannot be modified by the child; Seatbelt resolves symlinks.
	const profile = [
		"(version 1)",
		"(allow default)",
		"(deny file-write*)",
		`(allow file-write* ${writes.map((root) => `(subpath ${JSON.stringify(root)})`).join(" ")} (literal "/dev/null"))`,
	].join("\n");
	context.runtime.claudeLogin = {
		mode: "existing-keychain-private-config",
		writeRoots: writes,
		reads: "unrestricted",
		network: "unrestricted",
	};
	return {
		prefix: ["/usr/bin/sandbox-exec", "-p", profile],
		env: {
			...context.env,
			HOME: home,
			USER: login.user,
			CLAUDE_CONFIG_DIR: config,
			CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
		},
	};
}
