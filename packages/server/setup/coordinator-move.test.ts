import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import {
	CoordinatorMoveRoutes,
	type MoveProgress,
	moveFiles,
} from "./coordinator-move";

const HOME = "/home/.splates";
const FILES = moveFiles(HOME);

describe("CoordinatorMoveRoutes", () => {
	let fs: FakeFs;
	let ps: FakePs;
	let dev: string | null;
	let routes: CoordinatorMoveRoutes;

	beforeEach(() => {
		fs = new FakeFs();
		ps = new FakePs();
		ps.self = ["/bin/bun", "/opt/splates/cli.ts"];
		ps.setCwd("/code/app");
		dev = "http://127.0.0.1:4310";
		routes = new CoordinatorMoveRoutes({
			fs,
			ps,
			home: HOME,
			device: new FakeSecretStore(),
			dev: () => dev,
		});
	});

	const progress = async (): Promise<MoveProgress> =>
		(await routes.progress()).json() as Promise<MoveProgress>;

	it("starts the move on its own, deaf to this server's exit, stopping this server", async () => {
		const started = await routes.start();

		expect(started.status).toBe(200);
		const [call] = ps.getCalls();
		expect(call).toContain(
			"'/bin/bun' '/opt/splates/cli.ts' 'server' 'deploy' '--dev' 'http://127.0.0.1:4310'",
		);
		expect(ps.getCallDirs()).toEqual(["/code/app"]);
	});

	it("says how a move here went, its last lines and the box's host", async () => {
		await fs.write(
			FILES.log,
			"bringing splates on the box\nreadying each clone\n",
		);
		await fs.write(FILES.pid, `${ps.pid}\n`);

		expect(await progress()).toEqual({
			moved: false,
			running: true,
			exitCode: null,
			log: ["bringing splates on the box", "readying each clone"],
			host: null,
		});

		await fs.write(FILES.exit, "1\n");

		expect(await progress()).toMatchObject({ running: false, exitCode: 1 });
	});

	it("refuses a second move while one runs", async () => {
		await fs.write(FILES.pid, `${ps.pid}\n`);

		const refused = await routes.start();

		expect(refused.status).toBe(409);
		expect(ps.getCalls()).toEqual([]);
	});

	it("refuses once moved, as on the box", async () => {
		await fs.write("/etc/systemd/system/splates-coordinator.service", "");

		expect((await progress()).moved).toBe(true);
		expect((await routes.start()).status).toBe(409);
	});

	it("clears what the last move left before starting again", async () => {
		await fs.write(FILES.log, "cannot move yet\n");
		await fs.write(FILES.exit, "1\n");

		await routes.start();

		expect(await progress()).toMatchObject({ exitCode: null, log: [] });
	});

	it("waits until this server listens", async () => {
		dev = null;

		expect((await routes.start()).status).toBe(503);
	});
});
