import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/app/lib/prisma.js";
import { LOCKABLE_ROWS } from "../src/app/utils/rowLock.js";

/**
 * `lockRow` names its tables as strings, because there is no typed way to say
 * `FOR UPDATE` through Prisma. That makes a schema rename dangerous: the lock
 * would throw at runtime, and only when two people happened to click at once —
 * the exact case it exists to protect. This checks the map against the real
 * database instead.
 */

afterAll(() => prisma.$disconnect());

describe("lockable tables", () => {
  it("all exist, with the columns the lock query uses", async () => {
    const names = Object.values(LOCKABLE_ROWS).map((entry) => entry.table);
    expect(names.length).toBeGreaterThan(0);

    const found = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY(${names})`;

    for (const table of names) {
      const columns = found.filter((row) => row.table_name === table).map((row) => row.column_name);
      expect(columns, `table "${table}" is missing — check its @@map`).not.toHaveLength(0);
      // The three the lock query references by name.
      for (const column of ["id", "agencyId", "isDeleted"]) {
        expect(columns, `"${table}" has no "${column}" column`).toContain(column);
      }
    }
  });
});
