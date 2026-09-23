import fs from "node:fs";

/**
 * How much memory this process is actually allowed, and how much an import of
 * a given file is going to want.
 *
 * Reading a spreadsheet is the one thing this API does that allocates in
 * hundreds of megabytes at once. When the container's limit is below that, the
 * kernel kills the process part of the way through — no exception, no log line
 * from us, nothing for the agency to read. What they see is a progress bar
 * stopped at 8% and an import that never finishes, which tells them nothing
 * and tells whoever runs the server less.
 *
 * So the limit is read before the work starts and the import refuses itself,
 * in a sentence that names both figures. A refusal somebody can act on beats a
 * silent death every time.
 */

/** cgroup v2 first, then v1. Absent outside a container, which is fine. */
const CGROUP_FILES = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes",
];

/**
 * Anything at or above this is "no limit set" rather than a real one. cgroup
 * v1 reports an unlimited container as a number near 2^63, and v2 as "max".
 */
const EFFECTIVELY_UNLIMITED = 64 * 1024 * 1024 * 1024;

export const containerMemoryLimit = (): number | null => {
  for (const path of CGROUP_FILES) {
    let raw: string;
    try {
      raw = fs.readFileSync(path, "utf8").trim();
    } catch {
      continue;
    }

    if (raw === "max") return null;

    const bytes = Number(raw);
    if (!Number.isFinite(bytes) || bytes <= 0) continue;
    if (bytes >= EFFECTIVELY_UNLIMITED) return null;

    return bytes;
  }

  return null;
};

const MB = 1024 * 1024;

/**
 * What an import of this file will want, at its peak.
 *
 * Fitted to a measurement rather than guessed. A client's 3.34 MB workbook
 * peaks at 665 MB through the whole run, in a container with the limit
 * actually enforced, off a 200 MB baseline — so about 140 MB for every
 * megabyte of file, because what costs the memory is the parsed model of every
 * cell in it. The tenth on top is margin: a run that only just fits is a run
 * that dies on the day the sheet grows.
 */
export const estimateImportMemory = (fileBytes: number) =>
  Math.round((200 * MB + (fileBytes / MB) * 140 * MB) * 1.1);

/**
 * The reason a file this size cannot be read under a limit this size, or null.
 *
 * Split from the reading of the limit so it can be tested against figures
 * rather than against whatever the machine running the tests happens to be.
 */
export const memoryProblemFor = (limit: number | null, fileBytes: number): string | null => {
  // No cgroup to read: plenty of ways of running this have none, and refusing
  // on no evidence would be worse than letting it try.
  if (limit === null) return null;

  const needed = estimateImportMemory(fileBytes);
  if (limit >= needed) return null;

  const asMb = (bytes: number) => Math.round(bytes / MB);

  // Written for whoever reads it, which is the agency and not the person who
  // runs the server. The two figures are worth giving — they are what makes
  // the request concrete — but the file that sets the limit and the runbook
  // that explains it sit on a machine a tenant has no access to, and naming
  // them only tells them about our deployment.
  return (
    `This spreadsheet needs about ${asMb(needed)} MB to read, and this server allows ` +
    `the app only ${asMb(limit)} MB. The import was not started, rather than being ` +
    `stopped halfway through. Ask whoever runs your server to raise the memory limit ` +
    `on the Travelar API, then try again.`
  );
};

/** The same question, about this process as it is actually running. */
export const importMemoryProblem = (fileBytes: number): string | null =>
  memoryProblemFor(containerMemoryLimit(), fileBytes);
