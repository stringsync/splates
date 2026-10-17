import { nativeAdapter } from "./native-adapter";
import { claudeDriver } from "./native-claude";
import { nativeCodex } from "./native-codex";
import { opencodeDriver } from "./native-opencode";
import type { Allowance } from "./probe-affordability";
import type { Target } from "./runner";

/** Native commands are independent of the ACP roster and never initiate login. */
export function nativeTarget(value: string, opts: NativeTargetOptions): Target {
	const [id, ...parts] = value.split(":");
	const model = parts.join(":");
	if (!model || !["claude", "codex", "opencode"].includes(id ?? "")) {
		throw new Error(
			"--target requires claude:MODEL, codex:MODEL or opencode:PROVIDER/MODEL; ACP roster commands are not native transports",
		);
	}
	if (id === "opencode" && !/^[^/]+\/.+$/.test(model)) {
		throw new Error("OpenCode requires provider/model");
	}
	const driver =
		id === "claude"
			? claudeDriver({ allowance: opts.allowance })
			: id === "codex"
				? nativeCodex({ allowance: opts.allowance, codexHome: opts.codexHome })
				: opencodeDriver({ allowance: opts.allowance });
	const quote = driver.quote;
	driver.quote = (probe, selected) => {
		const reserved = quote(probe, selected);
		return (
			reserved && {
				...reserved,
				tokens: Math.min(reserved.tokens, probe.bounds.tokens),
			}
		);
	};
	return {
		selector: id,
		adapter: nativeAdapter(driver, { source: opts.source, mode: opts.mode }),
		model,
	};
}

interface NativeTargetOptions {
	source: string;
	mode: "discovery" | "explicit";
	allowance: Allowance;
	codexHome?: string;
}
