/**
 * What one WebSocket the server upgraded does, handed over as the socket's
 * data on the upgrade, since Bun takes one handler for every socket: a
 * terminal's shell, a dictation's transcription.
 */
export interface Connection {
	open(socket: Bun.ServerWebSocket<Connection>): void;
	message(
		socket: Bun.ServerWebSocket<Connection>,
		message: string | Buffer<ArrayBuffer>,
	): void;
	/** The socket closed, from either end. */
	closed(socket: Bun.ServerWebSocket<Connection>): void;
}

/** The server's one handler, which leaves each socket to its own connection. */
export const CONNECTIONS: Bun.WebSocketHandler<Connection> = {
	// Set rather than left at Bun's default, above what a worker frame holds (WorkerProtocol.maxPayloadBytes, which a test pins; importing it here would be a cycle).
	maxPayloadLength: 32 * 1024 * 1024,
	open: (socket) => socket.data.open(socket),
	message: (socket, message) => socket.data.message(socket, message),
	close: (socket) => socket.data.closed(socket),
};
