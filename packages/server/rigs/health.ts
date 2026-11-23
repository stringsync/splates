import type { Ps } from "core/system";
import type { Rig } from "./wire";

/** How long a health check may take. */
const CHECK_TIMEOUT_MS = 3000;

/** Checks whether a running rig is healthy according to its `health` declaration. */
export async function checkRigHealth(
	ps: Pick<Ps, "spawnCapture">,
	rig: Rig,
	ports: Record<string, number>,
	cwd: string,
	env: Record<string, string>,
): Promise<{ passed: boolean; summary: string | null }> {
	const { health } = rig;
	if (health === undefined) {
		return { passed: true, summary: null };
	}
	if ("command" in health) {
		const result = await ps
			.spawnCapture(["sh", "-c", health.command], {
				cwd,
				env,
				stdin: "",
				timeoutMs: CHECK_TIMEOUT_MS,
			})
			.catch(() => null);
		const code = result?.exitCode ?? null;
		return {
			passed: code === 0,
			summary: `${health.command} → ${code === null ? "did not run" : `exit ${code}`}`,
		};
	}
	const port = ports[health.port ?? (rig.ports[0] as string)];
	try {
		const answer = await fetch(`http://127.0.0.1:${port}${health.http}`, {
			redirect: "manual",
			signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
		});
		await answer.body?.cancel().catch(() => {});
		return {
			passed: answer.status >= 200 && answer.status < 400,
			summary: `GET ${health.http} → ${answer.status}`,
		};
	} catch {
		return { passed: false, summary: `GET ${health.http} → no answer` };
	}
}

/** Finds an available local loopback port. */
export async function freePort(): Promise<number> {
	const server = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: { data() {} },
	});
	const { port } = server;
	server.stop(true);
	return port;
}
