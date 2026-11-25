import { ChevronRightIcon } from "lucide-react";
import type { JSX } from "react";
import { countStates, type SpecFile, specCount } from "./eval-scenarios";
import { FileIcon } from "./file-chip";
import { evalFileAddress } from "./page-address";

/**
 * The Evals page's eval files as one card: a row a file, with its name, the
 * folder it sits in, how many specs it holds and a bar of how they stand.
 * A row opens the file's own page.
 */
export function EvalFileList({ files }: { files: SpecFile[] }): JSX.Element {
	return (
		<ul
			aria-label="eval files"
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			{files.map((file) => (
				<li key={file.key} className="border-t first:border-t-0">
					<EvalFileRow file={file} />
				</li>
			))}
		</ul>
	);
}

function EvalFileRow({ file }: { file: SpecFile }): JSX.Element {
	const counts = countStates(file.rows);
	const total = file.rows.length;
	const share = (count: number): string => `${(count / total) * 100}%`;
	return (
		<a
			href={evalFileAddress(file.key)}
			className="flex min-h-14 items-center gap-3 px-3.5 py-2.5 hover:bg-accent/50"
		>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-center gap-1.5">
					{file.folder !== "" && (
						<FileIcon path={file.name} className="size-3.5" />
					)}
					<span className="truncate font-medium font-mono text-sm">
						{file.name}
					</span>
				</span>
				{file.folder !== "" && (
					<span
						className="truncate pl-5 font-mono text-muted-foreground text-xs"
						title={file.key}
					>
						{file.folder}
					</span>
				)}
			</span>
			<span className="text-muted-foreground text-xs tabular-nums whitespace-nowrap">
				{specCount(total)}
			</span>
			<span
				role="img"
				aria-label={`${counts.failing} failing, ${counts.passing} passing, ${counts["never-run"]} not run`}
				className="flex h-1.5 w-11 shrink-0 overflow-hidden rounded-full bg-muted sm:w-16"
			>
				<span
					className="bg-destructive"
					style={{ width: share(counts.failing) }}
				/>
				<span
					className="bg-emerald-500"
					style={{ width: share(counts.passing) }}
				/>
			</span>
			<ChevronRightIcon
				aria-hidden
				className="size-3.5 shrink-0 text-muted-foreground"
			/>
		</a>
	);
}
