import { describe, expect, it } from "vitest";
import {
  estimateImportMemory,
  memoryProblemFor,
} from "../src/app/module/import/memoryLimit.js";

/**
 * Refusing an import the server cannot hold.
 *
 * A client uploaded a 3.3 MB workbook to an API container allowed 512 MB. The
 * kernel killed the process partway through reading it — no exception, no log
 * line, nothing on screen but a progress bar stopped at 8%. They tried three
 * times. The point of this check is that the fourth attempt says why.
 */

const MB = 1024 * 1024;

describe("whether this server can hold this import", () => {
  it("refuses the file that was actually killed, and says both figures", () => {
    // The real case: 3.3 MB of spreadsheet, 512 MB of container.
    const problem = memoryProblemFor(512 * MB, Math.round(3.3 * MB));

    expect(problem).not.toBeNull();
    expect(problem).toContain("512 MB");
    // Measured at 665 MB for this file, so the estimate has to be in that region
    // rather than a round number someone liked.
    expect(problem).toMatch(/\b(6[0-9]{2}|7[0-9]{2}) MB\b/);
    expect(problem).toMatch(/memory limit/i);
    // Written for the agency, who can do nothing with a path in our repository.
    expect(problem).not.toMatch(/docker-compose|README|deploy\//i);
  });

  it("allows it once the limit is the one the compose file now sets", () => {
    expect(memoryProblemFor(1536 * MB, Math.round(3.3 * MB))).toBeNull();
  });

  it("allows a small file on a small server", () => {
    // Most agencies are not carrying five thousand rows of history.
    expect(memoryProblemFor(512 * MB, 1 * MB)).toBeNull();
  });

  it("says nothing when there is no limit to read", () => {
    // Outside a container there is no cgroup, and refusing on no evidence
    // would be worse than letting it try.
    expect(memoryProblemFor(null, 50 * MB)).toBeNull();
  });

  it("scales with the file, because that is what costs the memory", () => {
    const small = estimateImportMemory(1 * MB);
    const large = estimateImportMemory(10 * MB);

    expect(large).toBeGreaterThan(small * 3);
  });
});
