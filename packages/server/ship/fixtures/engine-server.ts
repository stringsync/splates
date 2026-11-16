// The engine as a server runs it, in a process of its own a test can kill:
// `bun engine-server.ts <storage> <cwd> [start]` resumes the runs kept in
// `<storage>`, starting one of the fixture's `app` first with `start`, and
// runs until it is killed.
import { UuidProvider } from "core/id";
import { ConsoleLogger } from "core/log";
import { NodeFs, NodePs } from "core/system";
import { FsStorage } from "../../storage";
import { ShipEngine } from "../engine";
import { ShellStepProcesses } from "../step-processes";

const [storage, cwd, start] = process.argv.slice(2) as [
	string,
	string,
	string?,
];
const command = `bun ${import.meta.dir}/ship-command.ts`;
const engine = new ShipEngine({
	storage: new FsStorage(storage, new NodeFs()),
	processes: new ShellStepProcesses(new NodePs(), cwd),
	clock: { now: () => Date.now() },
	ids: new UuidProvider(),
	log: new ConsoleLogger(),
});
await engine.resume();
if (start === "start") {
	await engine.start([
		{
			name: "app",
			command,
			dependencies: [],
			steps: [
				{ id: "slow", does: "Wait for go" },
				{ id: "ask", does: "Ask for a code", dependencies: ["slow"] },
			],
		},
	]);
}
setInterval(() => {}, 1000);
