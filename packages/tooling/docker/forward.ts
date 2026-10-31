// Forwards a port on every interface to one on a host, the loopback by
// default. For the server in a container: `splates server` listens on
// the loopback alone, which `docker run -p` cannot reach, so this stands
// where the box's tunnel would. For a worker in a container: it will not
// dial a server on another machine over plain http, so this makes
// `host.docker.internal` answer on its own loopback.
// `bun forward.ts <from> <to> [host]`
const [from, to] = process.argv.slice(2, 4).map(Number);
const host = process.argv[4] ?? "127.0.0.1";
if (!from || !to) {
	throw new Error("usage: bun forward.ts <from> <to> [host]");
}

interface Pipe {
	upstream?: Bun.Socket<Pipe>;
	/** What arrived before the upstream connected. */
	waiting: Uint8Array[];
}

Bun.listen<Pipe>({
	hostname: "0.0.0.0",
	port: from,
	socket: {
		open(client) {
			client.data = { waiting: [] };
			Bun.connect<Pipe>({
				hostname: host,
				port: to,
				socket: {
					open(upstream) {
						upstream.data = { upstream: client, waiting: [] };
						client.data.upstream = upstream;
						for (const chunk of client.data.waiting) {
							upstream.write(chunk);
						}
						client.data.waiting = [];
					},
					data(upstream, chunk) {
						upstream.data.upstream?.write(chunk);
					},
					close(upstream) {
						upstream.data.upstream?.end();
					},
					error(upstream) {
						upstream.data.upstream?.end();
					},
				},
			}).catch(() => client.end());
		},
		data(client, chunk) {
			if (client.data.upstream) {
				client.data.upstream.write(chunk);
			} else {
				client.data.waiting.push(chunk);
			}
		},
		close(client) {
			client.data.upstream?.end();
		},
		error(client) {
			client.data.upstream?.end();
		},
	},
});
