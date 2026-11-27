/**
 * Runs `run` once fewer than {@link AT_ONCE} others are running. Bun starts
 * every concurrent test together, and each merge test drives dozens of real
 * git processes: uncapped, a file took four to seven times its wall in CPU,
 * mostly in the kernel, for little less wall than four at a time.
 */
export const few = async <T>(run: () => Promise<T>): Promise<T> => {
	while (running >= AT_ONCE) {
		await new Promise<void>((resolve) => queued.push(resolve));
	}
	running++;
	try {
		return await run();
	} finally {
		running--;
		queued.shift()?.();
	}
};

const AT_ONCE = 3;
let running = 0;
const queued: (() => void)[] = [];
