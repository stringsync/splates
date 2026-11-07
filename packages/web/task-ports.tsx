import type { PortLink } from "@splates/server/ports";
import { type JSX, useEffect, useState } from "react";
import { taskPorts } from "./api";
import { CardSection } from "./card-section";

/**
 * The ports task `task`'s processes listen on, read as the dialog opens: each
 * with its link through the ports host, which opens anywhere behind Access,
 * and its link on the machine `splates server` runs on. Nothing while it
 * serves none.
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
		<CardSection label="ports" title="Ports">
			<ul className="flex flex-col gap-0.5 text-xs tabular-nums">
				{ports.map(({ port, remote, local }) => (
					<li key={port} className="flex min-w-0 flex-wrap gap-x-2">
						<span className="text-muted-foreground">{port}</span>
						{remote !== null && <PortAnchor href={remote} />}
						<PortAnchor href={local} />
					</li>
				))}
			</ul>
		</CardSection>
	);
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
