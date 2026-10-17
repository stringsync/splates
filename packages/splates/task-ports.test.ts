import { describe, expect, it } from "bun:test";
import type { ProcessEntry } from "webappwiz/system";
import { taskPorts } from "./task-ports";

const proc = (pid: number, ppid: number): ProcessEntry => ({
	pid,
	ppid,
	pgid: pid,
	tpgid: 0,
	command: "node",
});

describe("taskPorts", () => {
	it("takes a port served from inside a task's worktree", () => {
		expect(
			taskPorts(
				[proc(20, 1)],
				[{ pid: 20, host: "*", port: 5173, cwd: "/repo-tasks/auth/web" }],
				{
					worktrees: [
						{ task: "auth", path: "/repo-tasks/auth" },
						{ task: "auth-two", path: "/repo-tasks/auth-two" },
					],
					agents: [],
				},
			),
		).toEqual([{ task: "auth", port: 5173 }]);
	});

	it("takes a port served under a task's agent from anywhere", () => {
		expect(
			taskPorts(
				[proc(10, 1), proc(11, 10), proc(12, 11)],
				[{ pid: 12, host: "127.0.0.1", port: 3000, cwd: "/tmp/elsewhere" }],
				{ worktrees: [], agents: [{ task: "auth", pid: 10 }] },
			),
		).toEqual([{ task: "auth", port: 3000 }]);
	});

	it("leaves out what no task serves, and lists a port once", () => {
		expect(
			taskPorts(
				[proc(30, 1), proc(31, 1)],
				[
					{ pid: 30, host: "*", port: 4269, cwd: "/repo" },
					{ pid: 31, host: "127.0.0.1", port: 8080, cwd: "/repo-tasks/b" },
					{ pid: 31, host: "[::1]", port: 8080, cwd: "/repo-tasks/b" },
					{ pid: 31, host: "*", port: 22, cwd: null },
				],
				{ worktrees: [{ task: "b", path: "/repo-tasks/b" }], agents: [] },
			),
		).toEqual([{ task: "b", port: 8080 }]);
	});

	it("matches a macOS temp path by its real path", () => {
		expect(
			taskPorts(
				[proc(40, 1)],
				[{ pid: 40, host: "*", port: 9000, cwd: "/private/var/t/c" }],
				{ worktrees: [{ task: "c", path: "/var/t/c" }], agents: [] },
			),
		).toEqual([{ task: "c", port: 9000 }]);
	});
});
