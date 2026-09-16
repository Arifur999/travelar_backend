import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  DocumentStatus,
  PostingDirection,
  PostingSource,
  VisaStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { lockRow } from "../../utils/rowLock.js";
import {
  VISA_DOCUMENT_PRESETS,
  VISA_TRANSITIONS,
  visaFilterableFields,
  visaSearchableFields,
} from "./visa.constant.js";
import {
  IChangeVisaStatusPayload,
  ICreateVisaCasePayload,
  IRecordVisaPaymentPayload,
  IUpdateVisaCasePayload,
} from "./visa.interface.js";

const toNumber = PostingService.toNumber;

const VISA_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, passportNo: true } },
  visaAgent: { select: { id: true, name: true, type: true } },
} satisfies Prisma.VisaCaseInclude;

/**
 *   totalFee  = serviceFee + embassyFee
 *   dueAmount = totalFee − Σ payments
 *
 * None of it stored — the fees are the only inputs, so deriving is cheaper than
 * keeping a total in step with them.
 */
// Generic so callers keep the full row type — the spread below passes every
// field through at runtime, and the signature now says so.
//
// Two grouped queries for a whole page (payments, document statuses), not two
// per case as before — see test/queryCount.test.ts.
const decorateMany = async <T extends { id: string; serviceFee: Prisma.Decimal; embassyFee: Prisma.Decimal }>(
  agencyId: string,
  visaCases: T[],
) => {
  if (visaCases.length === 0) return [];
  const ids = visaCases.map((visaCase) => visaCase.id);

  const [paid, documents] = await Promise.all([
    prisma.visaPayment.groupBy({
      by: ["visaCaseId"],
      where: { agencyId, visaCaseId: { in: ids } },
      _sum: { amount: true },
    }),
    prisma.visaDocument.groupBy({
      by: ["visaCaseId", "status"],
      where: { agencyId, visaCaseId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const paidByCase = new Map(paid.map((row) => [row.visaCaseId, toNumber(row._sum.amount)]));
  const progressByCase = new Map<string, { received: number; total: number }>();
  for (const row of documents) {
    const progress = progressByCase.get(row.visaCaseId) ?? { received: 0, total: 0 };
    progress.total += row._count._all;
    if (row.status !== DocumentStatus.PENDING) progress.received += row._count._all;
    progressByCase.set(row.visaCaseId, progress);
  }

  return visaCases.map((visaCase) => {
    const totalFee = toNumber(visaCase.serviceFee) + toNumber(visaCase.embassyFee);
    const totalPaid = paidByCase.get(visaCase.id) ?? 0;
    return {
      ...visaCase,
      totalFee,
      totalPaid,
      dueAmount: totalFee - totalPaid,
      documentsProgress: progressByCase.get(visaCase.id) ?? { received: 0, total: 0 },
    };
  });
};

const decorate = async <T extends { id: string; serviceFee: Prisma.Decimal; embassyFee: Prisma.Decimal }>(
  agencyId: string,
  visaCase: T,
) => (await decorateMany(agencyId, [visaCase]))[0]!;

const createVisaCase = async (agencyId: string, payload: ICreateVisaCasePayload, user: IRequestUser) => {
  const customer = await prisma.customer.findFirst({
    where: { id: payload.customerId, agencyId, isDeleted: false },
  });
  if (!customer) throw new AppError(status.BAD_REQUEST, "Invalid customer for this agency");

  if (payload.visaAgentId) {
    const agent = await prisma.visaAgent.findFirst({
      where: { id: payload.visaAgentId, agencyId, isDeleted: false },
    });
    if (!agent) throw new AppError(status.BAD_REQUEST, "Invalid visa agent for this agency");
  }

  const created = await prisma.$transaction(async (tx) => {
    const visaCase = await tx.visaCase.create({
      data: {
        agencyId,
        customerId: payload.customerId,
        visaAgentId: payload.visaAgentId ?? null,
        country: payload.country,
        visaType: payload.visaType,
        applicationNo: payload.applicationNo,
        submittedAt: payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
        serviceFee: new Prisma.Decimal(payload.serviceFee ?? 0),
        embassyFee: new Prisma.Decimal(payload.embassyFee ?? 0),
        // Always starts at SUBMITTED. The old implementation accepted a status
        // from the request body, so a case could be created already DELIVERED
        // and skip its own state machine entirely.
        status: VisaStatus.SUBMITTED,
        createdById: user.userId,
      },
    });

    const preset = VISA_DOCUMENT_PRESETS[payload.visaType.toLowerCase()] ?? VISA_DOCUMENT_PRESETS.other;
    await tx.visaDocument.createMany({
      data: preset.map((title) => ({ agencyId, visaCaseId: visaCase.id, title })),
    });

    await tx.visaStatusHistory.create({
      data: {
        agencyId,
        visaCaseId: visaCase.id,
        toStatus: VisaStatus.SUBMITTED,
        note: "Application submitted",
        changedById: user.userId,
      },
    });

    return visaCase;
  });

  return getVisaCaseById(agencyId, created.id);
};

const getAllVisaCases = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.VisaCaseGetPayload<{ include: typeof VISA_INCLUDE }>,
    Prisma.VisaCaseWhereInput,
    Prisma.VisaCaseInclude
  >(prisma.visaCase, query, {
    searchableFields: visaSearchableFields,
    filterableFields: visaFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .include(VISA_INCLUDE)
    .paginate()
    .sort()
    .fields()
    .execute();

  const decorated = await decorateMany(agencyId, result.data);

  const totals = await prisma.visaCase.aggregate({
    where: { agencyId, isDeleted: false },
    _sum: { serviceFee: true, embassyFee: true },
  });
  const paid = await prisma.visaPayment.aggregate({
    where: { agencyId, visaCase: { isDeleted: false } },
    _sum: { amount: true },
  });

  const totalRevenue = toNumber(totals._sum.serviceFee) + toNumber(totals._sum.embassyFee);

  return {
    ...result,
    data: decorated,
    summary: {
      totalRevenue,
      totalPaid: toNumber(paid._sum.amount),
      totalDue: totalRevenue - toNumber(paid._sum.amount),
    },
  };
};

const getVisaCaseById = async (agencyId: string, id: string) => {
  const visaCase = await prisma.visaCase.findFirst({
    where: { id, agencyId, isDeleted: false },
    include: {
      ...VISA_INCLUDE,
      documents: { orderBy: { createdAt: "asc" } },
      payments: {
        include: { cashAccount: { select: { id: true, name: true } } },
        orderBy: { paidAt: "asc" },
      },
      statusHistory: { orderBy: { changedAt: "asc" } },
    },
  });

  if (!visaCase) throw new AppError(status.NOT_FOUND, "Visa case not found");
  return decorate(agencyId, visaCase);
};

/// Status is deliberately absent — the status route is the only path that can
/// move a case through its lifecycle.
const updateVisaCase = async (agencyId: string, id: string, payload: IUpdateVisaCasePayload) => {
  const visaCase = await prisma.visaCase.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!visaCase) throw new AppError(status.NOT_FOUND, "Visa case not found");

  if (payload.visaAgentId) {
    const agent = await prisma.visaAgent.findFirst({
      where: { id: payload.visaAgentId, agencyId, isDeleted: false },
    });
    if (!agent) throw new AppError(status.BAD_REQUEST, "Invalid visa agent for this agency");
  }

  await prisma.visaCase.update({
    where: { id },
    data: {
      visaAgentId: payload.visaAgentId,
      country: payload.country,
      visaType: payload.visaType,
      applicationNo: payload.applicationNo,
      ...(payload.submittedAt && { submittedAt: new Date(payload.submittedAt) }),
      ...(payload.serviceFee !== undefined && { serviceFee: new Prisma.Decimal(payload.serviceFee) }),
      ...(payload.embassyFee !== undefined && { embassyFee: new Prisma.Decimal(payload.embassyFee) }),
    },
  });

  return getVisaCaseById(agencyId, id);
};

const changeVisaStatus = async (
  agencyId: string,
  id: string,
  payload: IChangeVisaStatusPayload,
  user: IRequestUser,
) => {
  const visaCase = await prisma.visaCase.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!visaCase) throw new AppError(status.NOT_FOUND, "Visa case not found");

  const allowed = VISA_TRANSITIONS[visaCase.status] ?? [];
  if (!allowed.includes(payload.status)) {
    throw new AppError(
      status.BAD_REQUEST,
      allowed.length > 0
        ? `Cannot change status from ${visaCase.status} to ${payload.status}. Allowed: ${allowed.join(", ")}`
        : `This case is ${visaCase.status} and cannot change status again`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.visaCase.update({
      where: { id },
      data: {
        status: payload.status,
        rejectionNote: payload.status === VisaStatus.REJECTED ? payload.note : undefined,
        ...(payload.status === VisaStatus.APPROVED || payload.status === VisaStatus.REJECTED
          ? { decidedAt: new Date() }
          : {}),
      },
    });

    await tx.visaStatusHistory.create({
      data: {
        agencyId,
        visaCaseId: id,
        fromStatus: visaCase.status,
        toStatus: payload.status,
        note: payload.note,
        changedById: user.userId,
      },
    });
  });

  return getVisaCaseById(agencyId, id);
};

/* ------------------------------ documents ------------------------------ */

const addDocument = async (agencyId: string, visaCaseId: string, title: string) => {
  const visaCase = await prisma.visaCase.findFirst({
    where: { id: visaCaseId, agencyId, isDeleted: false },
  });
  if (!visaCase) throw new AppError(status.NOT_FOUND, "Visa case not found");

  await prisma.visaDocument.create({ data: { agencyId, visaCaseId, title } });
  return getVisaCaseById(agencyId, visaCaseId);
};

/**
 * Checklist items are addressed by their own id, not an array index. The old
 * implementation used the position in an embedded array, which is only safe
 * while nothing is ever removed or reordered.
 */
const setDocumentStatus = async (
  agencyId: string,
  visaCaseId: string,
  documentId: string,
  documentStatus: DocumentStatus,
) => {
  const document = await prisma.visaDocument.findFirst({
    where: { id: documentId, visaCaseId, agencyId },
  });
  if (!document) throw new AppError(status.NOT_FOUND, "Checklist item not found");

  await prisma.visaDocument.update({
    where: { id: documentId },
    data: {
      status: documentStatus,
      // Clearing an item drops the file reference with it, rather than leaving
      // metadata pointing at something no longer claimed.
      ...(documentStatus === DocumentStatus.PENDING ? { fileUrl: null } : {}),
    },
  });

  return getVisaCaseById(agencyId, visaCaseId);
};

const deleteDocument = async (agencyId: string, visaCaseId: string, documentId: string) => {
  const document = await prisma.visaDocument.findFirst({
    where: { id: documentId, visaCaseId, agencyId },
  });
  if (!document) throw new AppError(status.NOT_FOUND, "Checklist item not found");

  await prisma.visaDocument.delete({ where: { id: documentId } });
  return getVisaCaseById(agencyId, visaCaseId);
};

/* ------------------------------- payments ------------------------------- */

/// Invoice-level, so over-payment is an error and the guard runs inside the
/// transaction that writes the row.
const recordPayment = async (
  agencyId: string,
  visaCaseId: string,
  payload: IRecordVisaPaymentPayload,
  user: IRequestUser,
) => {
  const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();

  await prisma.$transaction(async (tx) => {
    // First, so simultaneous payments for this case queue instead of each
    // summing the same total and all being allowed through. See rowLock.ts.
    await lockRow(tx, "visaCase", visaCaseId, agencyId);

    // Re-read under the lock: the fees must be the committed ones, not a
    // snapshot taken before the transaction opened.
    const visaCase = await tx.visaCase.findFirstOrThrow({
      where: { id: visaCaseId, agencyId, isDeleted: false },
    });

    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId);

    const agg = await tx.visaPayment.aggregate({
      where: { agencyId, visaCaseId },
      _sum: { amount: true },
    });
    const totalFee = toNumber(visaCase.serviceFee) + toNumber(visaCase.embassyFee);
    const due = totalFee - toNumber(agg._sum.amount);

    if (payload.amount > due) {
      throw new AppError(
        status.BAD_REQUEST,
        `Cannot take more than the outstanding due of ${due.toFixed(2)}`,
      );
    }

    const payment = await tx.visaPayment.create({
      data: {
        agencyId,
        visaCaseId,
        cashAccountId: payload.cashAccountId,
        amount: new Prisma.Decimal(payload.amount),
        method: payload.method,
        reference: payload.reference,
        note: payload.note,
        paidAt,
      },
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccountId,
      direction: PostingDirection.IN,
      amount: payload.amount,
      source: PostingSource.SALES_PAYMENT,
      sourceId: payment.id,
      postedAt: paidAt,
      note: payload.note,
      createdById: user.userId,
    });
  });

  return getVisaCaseById(agencyId, visaCaseId);
};

const deletePayment = async (agencyId: string, visaCaseId: string, paymentId: string) => {
  const payment = await prisma.visaPayment.findFirst({
    where: { id: paymentId, visaCaseId, agencyId },
  });
  if (!payment) throw new AppError(status.NOT_FOUND, "Payment not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, paymentId);
    await tx.visaPayment.delete({ where: { id: paymentId } });
  });

  return getVisaCaseById(agencyId, visaCaseId);
};

const deleteVisaCase = async (agencyId: string, id: string) => {
  const visaCase = await prisma.visaCase.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!visaCase) throw new AppError(status.NOT_FOUND, "Visa case not found");

  await prisma.$transaction(async (tx) => {
    const payments = await tx.visaPayment.findMany({ where: { agencyId, visaCaseId: id } });
    for (const payment of payments) {
      await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, payment.id);
    }
    await tx.visaPayment.deleteMany({ where: { agencyId, visaCaseId: id } });
    await tx.visaCase.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  });

  return { message: "Visa case deleted successfully" };
};

export const VisaService = {
  createVisaCase,
  getAllVisaCases,
  getVisaCaseById,
  updateVisaCase,
  changeVisaStatus,
  addDocument,
  setDocumentStatus,
  deleteDocument,
  recordPayment,
  deletePayment,
  deleteVisaCase,
};
