import { useEffect, useState } from "react";

export function CountdownTimer({ seconds }: { seconds: number }) {
	const [remaining, setRemaining] = useState(seconds);
	const [running, setRunning] = useState(false);
	const [finished, setFinished] = useState(false);

	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setRemaining((left) => left - 1), 1000);
		return () => clearInterval(id);
	}, [running]);

	useEffect(() => {
		if (remaining <= 0) {
			setRunning(false);
			setFinished(true);
		}
	}, [remaining]);

	return (
		<div>
			<span>{finished ? "Done" : `${remaining}s`}</span>
			<button onClick={() => setRunning(!running)}>{running ? "Pause" : "Start"}</button>
		</div>
	);
}
