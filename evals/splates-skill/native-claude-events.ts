import { basename, isAbsolute, relative, resolve } from "node:path";
import type { Event } from "./probe";

/** Executables whose command events say all they do to files; any other can read or write unobserved. */
export interface ClaudeEventsOptions {
	repository: string;
	/** Where task worktrees sit, so a file reads the same in the main tree and a worktree. */
	worktrees: string;
}

/**
 * Turns Claude's stream-json tool calls into execution events. A run's events
 * are complete only while every call is one it can name; `gaps` says why not.
 */
export function claudeEvents(opts: ClaudeEventsOptions) {
	const pending = new Map<string, Pending>();
	const gaps = new Set<string>();
	let count = 0;
	const id = (suffix = "") => `claude/${count++}${suffix}`;
	const name = (path: string) => {
		for (const root of [opts.repository, opts.worktrees]) {
			const inside = relative(root, path);
			if (inside && !inside.startsWith("..") && !isAbsolute(inside)) {
				// A worktree is one directory below its root: drop that directory.
				return root === opts.worktrees
					? inside.split("/").slice(1).join("/") || inside
					: inside;
			}
		}
		return path;
	};
	const file = (tool: Pending, path: string): Event => {
		const absolute = resolve(tool.cwd, path);
		return {
			id: id(),
			actor: "agent",
			kind: writes.has(tool.name) ? "write" : "read",
			name: name(absolute),
			args: [],
			payload: { path: absolute, cwd: tool.cwd, tool: tool.name },
		};
	};
	function shell(tool: Pending, exitCode: number): Event[] {
		const line = String(tool.input.command ?? "");
		// `(a || b)` runs b only when a fails: record a, and say so when it did fail.
		const fallback = /^\(([^()|]*)\|\|([^()|]*)\)(.*)$/s.exec(line.trim());
		const commands = tool.input.run_in_background
			? undefined
			: words(fallback ? `${fallback[1]}${fallback[3]}` : line);
		if (fallback && commands?.length && exitCode !== 0) {
			gaps.add(
				"a fallback after || may have run in place of the first command",
			);
		}
		if (!commands?.length) {
			gaps.add(
				"a Bash line with a pipe, redirect, substitution or background job is one opaque command",
			);
			return [
				{
					id: id(),
					actor: "agent",
					kind: "command",
					name: "bash",
					args: [line],
					exitCode,
					payload: { cwd: tool.cwd },
				},
			];
		}
		if (commands.length > 1) {
			gaps.add(
				"commands nested in a shell line have no exit code of their own",
			);
		}
		let cwd = tool.cwd;
		const events: Event[] = [];
		for (const [executable = "", ...args] of commands) {
			const program = basename(executable);
			if (!observed.has(program)) {
				gaps.add(`${program} may read or write files without a file event`);
			}
			events.push({
				id: id(),
				actor: "agent",
				kind: "command",
				name: program,
				args,
				...(commands.length === 1 ? { exitCode } : {}),
				payload: { cwd },
			});
			if (program === "cat" || program === "ls") {
				for (const path of args.filter((arg) => !arg.startsWith("-"))) {
					events.push(file({ name: "Read", input: {}, cwd }, path));
				}
			}
			if (program === "cd" && args[0]) {
				cwd = resolve(cwd, args[0]);
			}
		}
		return events;
	}
	function finish(tool: Pending, result: Record<string, unknown>): Event[] {
		if (tool.name === "Bash") {
			const text =
				typeof result.content === "string"
					? result.content
					: JSON.stringify(result.content);
			const code = /^Exit code (\d+)/.exec(text)?.[1];
			// A denied call has no exit code of a process that ran; it counts as a failure.
			const exitCode =
				code !== undefined ? Number(code) : result.is_error === true ? 1 : 0;
			return shell(tool, exitCode);
		}
		const path = tool.input.file_path ?? tool.input.notebook_path;
		if (
			(tool.name === "Read" || writes.has(tool.name)) &&
			typeof path === "string"
		) {
			return [file(tool, path)];
		}
		if (tool.name === "Glob" || tool.name === "Grep") {
			gaps.add(`${tool.name} reads files it does not name`);
		} else if (tool.name === "Task" || tool.name === "Agent") {
			gaps.add("subagent calls are not followed");
		} else if (!inert.has(tool.name)) {
			gaps.add(`${tool.name} has no event mapping`);
		}
		return [];
	}
	return {
		/** Why the events are not the whole story; empty means complete. */
		gaps: () => [...gaps],
		frame(frame: Record<string, unknown>, cwd: string): Event[] {
			const message = record(frame.message);
			const content = Array.isArray(message?.content) ? message.content : [];
			const events: Event[] = [];
			for (const part of content) {
				const block = record(part);
				if (frame.type === "assistant" && block?.type === "tool_use") {
					if (typeof block.id === "string" && typeof block.name === "string") {
						pending.set(block.id, {
							name: block.name,
							input: record(block.input) ?? {},
							cwd,
						});
					}
				} else if (frame.type === "user" && block?.type === "tool_result") {
					const tool = pending.get(String(block.tool_use_id));
					if (tool) {
						pending.delete(String(block.tool_use_id));
						events.push(...finish(tool, block));
					}
				}
			}
			return events;
		},
		/** Calls still waiting for a result when the stream ended. */
		unfinished(): Event[] {
			const events: Event[] = [];
			for (const tool of pending.values()) {
				gaps.add(`${tool.name} never returned a result`);
				if (tool.name === "Bash") {
					events.push(
						...shell(tool, 0).map(({ exitCode: _, ...rest }) => rest),
					);
				}
			}
			pending.clear();
			return events;
		},
	};
}

/** Characters that make a line more than a list of plain commands. */
const shellSyntax = "|&<>()`$" + "{}*?~#";
const observed = new Set([
	"splates",
	"git",
	"bun",
	"bunx",
	"cd",
	"pwd",
	"echo",
	"cat",
	"ls",
]);
const writes = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Tools that touch no project file and run no process. */
const inert = new Set(["Skill", "TodoWrite", "ToolSearch"]);

interface Pending {
	name: string;
	input: Record<string, unknown>;
	cwd: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** Split a shell line into words, or undefined when it needs a real shell (pipes, redirects, substitution). */
function words(line: string): string[][] | undefined {
	const commands: string[][] = [[]];
	let word: string | undefined;
	let quote: string | undefined;
	const end = () => {
		if (word !== undefined) {
			commands.at(-1)?.push(word);
			word = undefined;
		}
	};
	for (let i = 0; i < line.length; i++) {
		const char = line[i] as string;
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else if (quote === '"' && (char === "$" || char === "`")) {
				return undefined;
			} else if (quote === '"' && char === "\\") {
				word += line[++i] ?? "";
			} else {
				word += char;
			}
		} else if (char === "'" || char === '"') {
			quote = char;
			word ??= "";
		} else if (
			char === "2" &&
			word === undefined &&
			line.startsWith("2>&1", i) &&
			/^\s*$|^\s/.test(line.slice(i + 4, i + 5) || " ")
		) {
			// Stderr into stdout changes no file.
			i += 3;
		} else if (char === "\\") {
			word = (word ?? "") + (line[++i] ?? "");
		} else if (/\s/.test(char) && char !== "\n") {
			end();
		} else if (
			char === ";" ||
			char === "\n" ||
			(char === "&" && line[i + 1] === "&")
		) {
			end();
			if (char === "&") {
				i++;
			}
			commands.push([]);
		} else if (shellSyntax.includes(char)) {
			return undefined;
		} else {
			word = (word ?? "") + char;
		}
	}
	if (quote) {
		return undefined;
	}
	end();
	return commands.filter((command) => command.length > 0);
}
