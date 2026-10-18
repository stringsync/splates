import type { PortLink } from "@stringsync/splates-server/ports";
import { type JSX, useEffect, useState } from "react";
import { taskPorts } from "./api";
import { HEADING } from "./markdown";

/**
 * The ports task `task`'s processes listen on, read as the dialog opens: each
 * with its link through the ports host, which opens anywhere behind Access,
 * and its link on this machine: on the machine `splates server` runs on when
 * the page is open there, and otherwise on the worker that serves it, named,
 * which is where the user sits once the coordinator runs on a box. Nothing
 * while it serves none.
 */
export function TaskPorts({ task }: { task: string }): JSX.Element | null {
	const [ports, setPorts] = useState<PortLink[]>([]);
	useEffect(() => {
		let live = true;
		taskPorts().then(
			(all) => live && setPorts(all.filter((each) => each.task === task)),
			() => {},
		);
		return () => {
			live = false;
		};
	}, [task]);
	if (ports.length === 0) {
		return null;
	}
	return (
		<section aria-label="ports" className="flex min-w-0 flex-col">
			<h2 className={HEADING}>Ports</h2>
			<ul className="flex flex-col gap-0.5 text-xs tabular-nums">
				{ports.map(({ port, remote, local, onWorker, worker }) => (
					<li key={port} className="flex min-w-0 flex-wrap gap-x-2">
						<span className="text-muted-foreground">{port}</span>
						{remote !== null && <PortAnchor href={remote} />}
						{onCoordinator() ? (
							<PortAnchor href={local} />
						) : (
							<span className="flex min-w-0 gap-x-1">
								<PortAnchor href={onWorker} />
								<span className="text-muted-foreground">on {worker}</span>
							</span>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

/** Whether the page is open on the machine `splates server` runs on. */
function onCoordinator(): boolean {
	return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

function PortAnchor({ href }: { href: string }): JSX.Element {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="min-w-0 truncate underline underline-offset-2"
		>
			{href.replace(/^https?:\/\//, "")}
		</a>
	);
}
