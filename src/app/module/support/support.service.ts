import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role, SupportStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";

const TICKET_INCLUDE = {
  agency: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SupportTicketInclude;

/* ---------------------------- support tickets --------------------------- */

/**
 * Opens a thread with the platform operator. The ticket and its first message
 * are written together — the old code did them as two separate writes, so a
 * failure between them left a thread with nothing in it.
 */
const createTicket = async (
  agencyId: string,
  payload: { subject: string; message: string; category?: string; priority?: string },
  user: IRequestUser,
) => {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        agencyId,
        createdById: user.userId,
        subject: payload.subject,
        category: payload.category as never,
        priority: payload.priority as never,
      },
      include: TICKET_INCLUDE,
    });

    await tx.supportMessage.create({
      data: {
        supportTicketId: ticket.id,
        senderId: user.userId,
        senderRole: user.role,
        message: payload.message,
      },
    });

    return ticket;
  });
};

/// Scoped for a tenant, unscoped for the operator.
const listTickets = async (query: IqueryParams, agencyId?: string) => {
  const queryBuilder = new QueryBuilder<
    Prisma.SupportTicketGetPayload<{ include: typeof TICKET_INCLUDE }>,
    Prisma.SupportTicketWhereInput,
    Prisma.SupportTicketInclude
  >(prisma.supportTicket, query, {
    searchableFields: ["subject", "agency.name"],
    filterableFields: ["status", "priority", "category", "agencyId"],
  });

  return queryBuilder
    .search()
    .filter()
    .where(agencyId ? { agencyId } : {})
    .include(TICKET_INCLUDE)
    .paginate()
    .sort()
    .fields()
    .execute();
};

const getTicketById = async (id: string, agencyId?: string) => {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id, ...(agencyId ? { agencyId } : {}) },
    include: {
      ...TICKET_INCLUDE,
      messages: {
        include: { sender: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");
  return ticket;
};

const addMessage = async (id: string, message: string, user: IRequestUser, agencyId?: string) => {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id, ...(agencyId ? { agencyId } : {}) },
  });
  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");

  // A closed thread stops taking replies from the agency, but the operator can
  // always add a closing note.
  if (ticket.status === SupportStatus.CLOSED && user.role !== Role.SUPER_ADMIN) {
    throw new AppError(status.BAD_REQUEST, "This ticket is closed and no longer accepts replies");
  }

  await prisma.$transaction(async (tx) => {
    await tx.supportMessage.create({
      data: { supportTicketId: id, senderId: user.userId, senderRole: user.role, message },
    });
    // Touched so the list can sort by most-recently-active.
    await tx.supportTicket.update({ where: { id }, data: { updatedAt: new Date() } });
  });

  return getTicketById(id, agencyId);
};

const updateTicketStatus = async (id: string, ticketStatus: SupportStatus) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");

  await prisma.supportTicket.update({ where: { id }, data: { status: ticketStatus } });
  return getTicketById(id);
};

/* ----------------------------- announcements ---------------------------- */

const createAnnouncement = async (
  payload: { title: string; message: string; type?: string },
  user: IRequestUser,
) =>
  prisma.announcement.create({
    data: {
      title: payload.title,
      message: payload.message,
      type: payload.type as never,
      createdById: user.userId,
    },
  });

const listAnnouncementsForAdmin = async (query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.AnnouncementGetPayload<object>,
    Prisma.AnnouncementWhereInput,
    Prisma.AnnouncementInclude
  >(prisma.announcement, query, {
    searchableFields: ["title", "message"],
    filterableFields: ["type", "isActive"],
  });

  return queryBuilder.search().filter().paginate().sort().fields().execute();
};

/// What a tenant sees: live announcements, each flagged with whether this
/// particular user has already read it.
const listAnnouncementsForUser = async (user: IRequestUser) => {
  const announcements = await prisma.announcement.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    include: { reads: { where: { userId: user.userId }, select: { id: true } } },
  });

  return announcements.map(({ reads, ...announcement }) => ({
    ...announcement,
    isRead: reads.length > 0,
  }));
};

/**
 * Marking read is an upsert, so doing it twice is harmless.
 *
 * Only live announcements can be marked — the old code accepted any id,
 * including ones already withdrawn.
 */
const markAnnouncementRead = async (announcementId: string, user: IRequestUser) => {
  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, isActive: true },
  });
  if (!announcement) throw new AppError(status.NOT_FOUND, "Announcement not found");

  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId, userId: user.userId } },
    create: { announcementId, userId: user.userId },
    update: {},
  });

  return { message: "Marked as read" };
};

const updateAnnouncement = async (
  id: string,
  payload: { title?: string; message?: string; type?: string; isActive?: boolean },
) => {
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) throw new AppError(status.NOT_FOUND, "Announcement not found");

  return prisma.announcement.update({
    where: { id },
    data: {
      title: payload.title,
      message: payload.message,
      type: payload.type as never,
      isActive: payload.isActive,
    },
  });
};

export const SupportService = {
  createTicket,
  listTickets,
  getTicketById,
  addMessage,
  updateTicketStatus,
  createAnnouncement,
  listAnnouncementsForAdmin,
  listAnnouncementsForUser,
  markAnnouncementRead,
  updateAnnouncement,
};
