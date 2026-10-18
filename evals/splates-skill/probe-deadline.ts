import { Duration, SystemTimer, timeouts } from "webappwiz/time";

export async function bounded<T>(
	work: Promise<T>,
	milliseconds: number,
): Promise<T> {
	if (
		!(await timeouts.race(new SystemTimer(), work, Duration.ms(milliseconds)))
	) {
		throw new Error("observation/cleanup time limit");
	}
	return work;
}
