import status from "http-status";
import { ImportStatus, Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IImportRun } from "./import.interface.js";

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
 * The order things are deleted in, children first.
 *
 * A supplier cannot go while a payment points at it, and an account cannot go
 * while anything posted to it. Getting this order wrong shows up as a foreign
 * key error mid-rollback, which would leave the books half-undone.
 */
const DELETE_ORDER: { entity: string; remove: (tx: Tx, ids: string[], agencyId: string) => Promise<unknown> }[] = [
  { entity: "ticketPayment", remove: (tx, ids, agencyId) => tx.ticketPayment.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "dueReceived", remove: (tx, ids, agencyId) => tx.dueReceived.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "supplierTransaction", remove: (tx, ids, agencyId) => tx.supplierTransaction.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "expense", remove: (tx, ids, agencyId) => tx.expense.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "capitalFlow", remove: (tx, ids, agencyId) => tx.capitalFlow.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "ticket", remove: (tx, ids, agencyId) => tx.ticket.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "customer", remove: (tx, ids, agencyId) => tx.customer.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "supplier", remove: (tx, ids, agencyId) => tx.supplier.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "airline", remove: (tx, ids, agencyId) => tx.airlineMaster.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "expenseCategory", remove: (tx, ids, agencyId) => tx.expenseCategory.deleteMany({ where: { agencyId, id: { in: ids } } }) },
  { entity: "cashAccount", remove: (tx, ids, agencyId) => tx.cashAccount.deleteMany({ where: { agencyId, id: { in: ids } } }) },
];

const toRun = (run: {
  id: string;
  filename: string;
  stage: string;
  status: string;
  counts: Prisma.JsonValue;
  revertedAt: Date | null;
  createdAt: Date;
}): IImportRun => ({
  id: run.id,
  filename: run.filename,
  stage: run.stage as IImportRun["stage"],
  status: run.status as IImportRun["status"],
  counts: (run.counts ?? {}) as Record<string, number>,
  revertedAt: run.revertedAt ? run.revertedAt.toISOString() : null,
  createdAt: run.createdAt.toISOString(),
});

const listRuns = async (agencyId: string): Promise<IImportRun[]> => {
  const runs = await prisma.dataImport.findMany({
    where: { agencyId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return runs.map(toRun);
};

/**
 * Deletes everything one run created.
 *
 * Postings go with their rows: every money row here was created through a
 * service that posted to an account, and those postings carry the row's id as
 * their sourceId, so deleting the row cascades them away. An account's own
 * opening posting goes when the account does.
 */
const revertRun = async (agencyId: string, importId: string): Promise<IImportRun> => {
  const run = await prisma.dataImport.findFirst({ where: { id: importId, agencyId } });
  if (!run) throw new AppError(status.NOT_FOUND, "Import not found");
  if (run.status === ImportStatus.REVERTED) {
    throw new AppError(status.BAD_REQUEST, "This import has already been undone");
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
    for (const { entity, remove } of DELETE_ORDER) {
      const ids = byEntity.get(entity);
      if (!ids || ids.length === 0) continue;

      try {
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

export const ImportRunService = { listRuns, revertRun };
