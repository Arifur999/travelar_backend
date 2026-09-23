import status from "http-status";
import { ImportStatus, Prisma } from "../../../generated/prisma/client.js";
import { ImportStage, PostingSource } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IImportedRecord, IImportRun } from "./import.interface.js";

/**
 * What has been imported, and undoing one of them.
 *
 * An import that cannot be undone is one nobody dares run on real books. Every
 * row a run created is listed against it (ImportedRecord), so undoing is a
 * matter of deleting exactly those rows — not guessing from timestamps, and
 * never touching anything the agency typed in itself.
 */

type Tx = Prisma.TransactionClient;

/**
 * The order things are deleted in, children first, and the ledger entries each
 * kind owns.
 *
 * A supplier cannot go while a payment points at it, and an account cannot go
 * while anything is posted to it. Getting this order wrong shows up as a
 * foreign key error mid-rollback, which would leave the books half-undone.
 *
 * The postings matter as much as the rows. A posting has no foreign key to
 * what caused it — it carries (source, sourceId) instead, deliberately, so one
 * table can record movements from a dozen others. Nothing therefore cascades:
 * deleting a payment on its own would leave its money on the balance sheet
 * for ever, with no row left to explain it. Each kind names its own sources
 * here, and they go first.
 */
const DELETE_ORDER: {
  entity: string;
  sources: PostingSource[];
  remove: (tx: Tx, ids: string[], agencyId: string) => Promise<unknown>;
}[] = [
  {
    entity: "ticketPayment",
    // A payment settled from the customer's wallet posted nothing, so there
    // may be no row to delete; deleteMany simply matches none.
    sources: [PostingSource.SALES_PAYMENT],
    remove: (tx, ids, agencyId) => tx.ticketPayment.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "dueReceived",
    sources: [PostingSource.DUE_RECEIVED],
    remove: (tx, ids, agencyId) => tx.dueReceived.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "supplierTransaction",
    sources: [PostingSource.SUPPLIER_PAYMENT],
    remove: (tx, ids, agencyId) => tx.supplierTransaction.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "expense",
    sources: [PostingSource.EXPENSE],
    remove: (tx, ids, agencyId) => tx.expense.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "capitalFlow",
    sources: [PostingSource.INVESTMENT, PostingSource.INVESTMENT_WITHDRAWAL],
    remove: (tx, ids, agencyId) => tx.capitalFlow.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "profitWithdrawal",
    sources: [PostingSource.PROFIT_WITHDRAWAL],
    remove: (tx, ids, agencyId) => tx.profitWithdrawal.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "ticket",
    sources: [PostingSource.DATE_CHANGE_FEE],
    remove: (tx, ids, agencyId) => tx.ticket.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "route",
    sources: [],
    remove: (tx, ids, agencyId) => tx.routeMaster.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "customer",
    sources: [],
    remove: (tx, ids, agencyId) => tx.customer.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "supplier",
    sources: [],
    remove: (tx, ids, agencyId) => tx.supplier.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "airline",
    sources: [],
    remove: (tx, ids, agencyId) => tx.airlineMaster.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "expenseCategory",
    sources: [],
    remove: (tx, ids, agencyId) => tx.expenseCategory.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
  {
    entity: "cashAccount",
    // Its opening balance is a posting like any other, and the account's own
    // foreign key is Restrict — so the opening row has to go first or the
    // account cannot be deleted at all.
    sources: [PostingSource.OPENING],
    remove: (tx, ids, agencyId) => tx.cashAccount.deleteMany({ where: { agencyId, id: { in: ids } } }),
  },
];

/**
 * How long a run may go without saying anything before it is presumed dead.
 *
 * A live run writes its progress about a hundred times, so silence this long
 * means the process that was doing the work is gone — killed for memory,
 * restarted by a deploy, or crashed. Without this the record stays RUNNING for
 * ever, the screen shows a bar that will never move, and the next import is
 * refused because one is supposedly already going.
 */
const PRESUMED_DEAD_AFTER_MS = 10 * 60 * 1000;

const markStaleRuns = async (agencyId: string) => {
  const cutoff = new Date(Date.now() - PRESUMED_DEAD_AFTER_MS);

  await prisma.dataImport.updateMany({
    where: { agencyId, status: ImportStatus.RUNNING, updatedAt: { lt: cutoff } },
    data: {
      status: ImportStatus.FAILED,
      note: "The server restarted while this import was running. What it had already brought in is listed against it and can be undone, or upload the file again — a second run skips everything the first one finished.",
    },
  });
};

const toRun = (run: {
  id: string;
  filename: string;
  stage: string;
  status: string;
  counts: Prisma.JsonValue;
  progress: Prisma.JsonValue;
  result: Prisma.JsonValue;
  note: string | null;
  revertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): IImportRun => ({
  id: run.id,
  filename: run.filename,
  stage: run.stage as IImportRun["stage"],
  status: run.status as IImportRun["status"],
  counts: (run.counts ?? {}) as Record<string, number>,
  progress: (run.progress ?? null) as IImportRun["progress"],
  result: (run.result ?? null) as IImportRun["result"],
  note: run.note,
  revertedAt: run.revertedAt ? run.revertedAt.toISOString() : null,
  createdAt: run.createdAt.toISOString(),
  updatedAt: run.updatedAt.toISOString(),
});

/**
 * Writes down a finished run and every row it created.
 *
 * Both stages end here rather than each writing its own record, because the
 * rollback reads one list and one list only — a stage that forgot to add to it
 * would be a stage nobody could undo.
 */
const recordRun = async (input: {
  agencyId: string;
  filename: string;
  stage: ImportStage;
  counts: Record<string, number>;
  user: IRequestUser;
  recorded: IImportedRecord[];
}): Promise<string> => {
  const run = await prisma.dataImport.create({
    data: {
      agencyId: input.agencyId,
      filename: input.filename,
      stage: input.stage,
      status: ImportStatus.COMPLETED,
      counts: input.counts,
      createdById: input.user.userId,
    },
  });

  await attachRecords(input.agencyId, run.id, input.recorded);
  return run.id;
};

/**
 * Adds rows to an existing run's list.
 *
 * A stage that is half of a longer run writes against the run that started it,
 * so the whole upload is one thing to undo — which is how the owner thinks of
 * it, having pressed one button.
 */
const attachRecords = async (agencyId: string, importId: string, recorded: IImportedRecord[]) => {
  if (recorded.length === 0) return;

  await prisma.importedRecord.createMany({
    data: recorded.map((record) => ({
      agencyId,
      importId,
      entity: record.entity,
      entityId: record.entityId,
      sourceTab: record.sourceTab,
      sourceRow: record.sourceRow,
    })),
  });
};

const listRuns = async (agencyId: string): Promise<IImportRun[]> => {
  await markStaleRuns(agencyId);

  const runs = await prisma.dataImport.findMany({
    where: { agencyId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return runs.map(toRun);
};

/** One run, which is what the screen polls while the bar is moving. */
const getRun = async (agencyId: string, importId: string): Promise<IImportRun> => {
  await markStaleRuns(agencyId);

  const run = await prisma.dataImport.findFirst({ where: { id: importId, agencyId } });
  if (!run) throw new AppError(status.NOT_FOUND, "Import not found");
  return toRun(run);
};

/**
 * Deletes everything one run created, and the ledger entries that went with it.
 *
 * Nothing the agency typed in itself is touched: the run's own list of what it
 * created is the only thing consulted.
 */
const revertRun = async (agencyId: string, importId: string): Promise<IImportRun> => {
  const run = await prisma.dataImport.findFirst({ where: { id: importId, agencyId } });
  if (!run) throw new AppError(status.NOT_FOUND, "Import not found");
  if (run.status === ImportStatus.REVERTED) {
    throw new AppError(status.BAD_REQUEST, "This import has already been undone");
  }
  if (run.status === ImportStatus.RUNNING) {
    // Undoing half-written books would race the run still writing them.
    throw new AppError(status.BAD_REQUEST, "This import is still running — wait for it to finish first");
  }

  const records = await prisma.importedRecord.findMany({
    where: { agencyId, importId },
    select: { entity: true, entityId: true },
  });

  const byEntity = new Map<string, string[]>();
  for (const record of records) {
    byEntity.set(record.entity, [...(byEntity.get(record.entity) ?? []), record.entityId]);
  }

  await prisma.$transaction(async (tx) => {
    for (const { entity, sources, remove } of DELETE_ORDER) {
      const ids = byEntity.get(entity);
      if (!ids || ids.length === 0) continue;

      try {
        if (sources.length > 0) {
          await tx.accountPosting.deleteMany({
            where: { agencyId, source: { in: sources }, sourceId: { in: ids } },
          });
        }
        await remove(tx, ids, agencyId);
      } catch {
        // Something created by the import has been used since — a ticket sold
        // against an imported customer, say. Undoing would take that with it,
        // so the run stops and says which kind of record is in the way.
        throw new AppError(
          status.CONFLICT,
          `Some imported ${entity} records are now in use, so this import cannot be undone. Delete the newer records first, or keep the import.`,
        );
      }
    }

    await tx.importedRecord.deleteMany({ where: { agencyId, importId } });
    await tx.dataImport.update({
      where: { id: importId },
      data: { status: ImportStatus.REVERTED, revertedAt: new Date() },
    });
  });

  const updated = await prisma.dataImport.findFirstOrThrow({ where: { id: importId, agencyId } });
  return toRun(updated);
};

export const ImportRunService = {
  recordRun,
  attachRecords,
  markStaleRuns,
  listRuns,
  getRun,
  revertRun,
};
