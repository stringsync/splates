import { homedir } from "node:os";
import type { Fs, Ps } from "core/system";
import type { RosterModel } from "./roster";

/** Where Antigravity CLI's installer puts `agy`, which may be off the PATH. */
const AGY_BIN = ".local/bin/agy";

/** The shell's `agy`: `AGY_PATH`, else `agy` on the PATH, else the installer's. */
const AGY = `"\${AGY_PATH:-$(command -v agy || echo "$HOME/${AGY_BIN}")}"`;

// Default launch command saved by earlier versions.
export const LEGACY_AGY_ARGV = ["sh", "-c", `exec ${AGY} acp`];
/** Runs Antigravity with tool commands approved; set `AGY_PATH` to choose its executable. */
export const AGY_ARGV = [
	"sh",
	"-c",
	`exec ${AGY} acp --dangerously-skip-permissions`,
];

/** `agy` as found for {@link AGY_ARGV}, ahead of the arguments to run it with. */
export const AGY_CLI = ["sh", "-c", `exec ${AGY} "$@"`, "agy"];

/** Whether Antigravity CLI is installed on this machine, where {@link AGY_ARGV} looks. */
export async function agyInstalled({
	fs,
	ps,
}: {
	fs: Fs;
	ps: Ps;
}): Promise<boolean> {
	const named = ps.env("AGY_PATH");
	if (named !== undefined) {
		return await fs.exists(named);
	}
	const path = ps.env("PATH");
	if (path !== undefined && Bun.which("agy", { PATH: path }) !== null) {
		return true;
	}
	return await fs.exists(`${ps.env("HOME") ?? homedir()}/${AGY_BIN}`);
}

/**
 * The Gemini models Antigravity CLI can offer, depending on the account, by
 * the ids its Model setting takes; its Thinking Level setting is the effort. The Claude
 * and GPT models it also runs are left to their own agents.
 */
export const ANTIGRAVITY_MODELS: RosterModel[] = [
	{
		id: "gemini-4-carbon",
		name: "Gemini 4 Carbon",
		strengths: "hardest coding and long-horizon reasoning",
		cost: "high",
		tier: 4,
		speed: "slow",
		costRank: 3,
	},
	{
		id: "gemini-4-neon",
		name: "Gemini 4 Neon",
		strengths: "complex coding with a balance of depth and efficiency",
		cost: "medium",
		tier: 3,
		speed: "fast",
		costRank: 2,
	},
	{
		id: "gemini-4-hydrogen",
		name: "Gemini 4 Hydrogen",
		strengths: "fast everyday coding and execution",
		cost: "low",
		tier: 2,
		speed: "fast",
		costRank: 1,
	},
	{
		id: "gemini-4-argon",
		name: "Gemini 4 Argon",
		strengths: "complex coding and reasoning, the original Gemini 4",
		cost: "high",
		tier: 3,
		speed: "medium",
		costRank: 3,
	},
	{
		id: "gemini-3.8-flash",
		name: "Gemini 3.8 Flash",
		strengths: "everyday coding work, fast, with a long context",
		cost: "low",
		tier: 2,
		speed: "fast",
		costRank: 1,
	},
];
