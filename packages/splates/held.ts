import type { ProcessEntry } from "webappwiz/system";

/** A command a restart would kill: where it runs, and what it runs. */
export interface Held {
	/** The agent that left it running, or `terminal` for a page's shell. */
	where: string;
	command: string;
}

/** The programs an agent runs its commands in. */
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh"]);

/**
 * What a restart would kill, from the process table: the job in front in
 * each of the page's `shells`, and each command an idle agent in `agents`
 * left running, in a shell under the agent leading a process group of its
 * own, as an agent runs each command. Its MCP servers, and the shells and
 * browsers they start in the agent's group, are not commands it ran, so they
 * hold nothing.
 */
export function heldBy(
	table: ProcessEntry[],
	{
		shells,
		agents,
	}: { shells: number[]; agents: { name: string; pid: number }[] },
): Held[] {
	const byPid = new Map(table.map((each) => [each.pid, each]));
	const children = new Map<number, ProcessEntry[]>();
	for (const each of table) {
		children.set(each.ppid, [...(children.get(each.ppid) ?? []), each]);
	}
	const held: Held[] = [];
	for (const pid of shells) {
		const shell = byPid.get(pid);
		if (shell === undefined || shell.tpgid <= 0 || shell.tpgid === shell.pgid) {
			continue;
		}
		const front =
			byPid.get(shell.tpgid) ?? table.find((each) => each.pgid === shell.tpgid);
		if (front !== undefined) {
			held.push({ where: "terminal", command: front.command });
		}
	}
	for (const { name, pid } of agents) {
		// Down to the first command on each branch: a shell under one is the
		// command's own.
		const look = (under: number): void => {
			for (const child of children.get(under) ?? []) {
				if (child.pgid !== child.pid || !isShell(child.command)) {
					look(child.pid);
					continue;
				}
				const ran = children.get(child.pid)?.[0];
				held.push({ where: name, command: (ran ?? child).command });
			}
		};
		look(pid);
	}
	return held;
}

function isShell(command: string): boolean {
	const program = command.split(" ")[0] ?? "";
	return SHELLS.has(
		program.slice(program.lastIndexOf("/") + 1).replace(/^-/, ""),
	);
}
