import { dlopen, FFIType, ptr } from "bun:ffi";

/** `RUSAGE_INFO_V2`, and where `ri_phys_footprint` sits in it, in 64-bit words. */
const RUSAGE_INFO_V2 = 2;
const FOOTPRINT = 9;

/**
 * The physical footprint of process `pid` in bytes, as Activity Monitor's
 * Memory column and `footprint` count it, or null when it cannot be read, as
 * for another user's process. Resident size counts shared and reclaimable
 * pages too, which overstates a Bun or Node process several times over.
 */
export function darwinFootprint(pid: number): number | null {
	opened ??= open();
	const info = new BigUint64Array(40);
	return opened.proc_pid_rusage(pid, RUSAGE_INFO_V2, ptr(info)) === 0
		? Number(info[FOOTPRINT])
		: null;
}

let opened: ReturnType<typeof open> | null = null;

/** Opened on the first reading, never on import, so Linux never tries. */
function open() {
	return dlopen("/usr/lib/libproc.dylib", {
		proc_pid_rusage: {
			args: [FFIType.i32, FFIType.i32, FFIType.ptr],
			returns: FFIType.i32,
		},
	}).symbols;
}
