import { AttendanceStatus, EmployeePayoutType } from "../../../generated/prisma/enums.js";

export interface ICreateEmployeePayload {
  name: string;
  phone: string;
  address?: string;
  joinDate: string;
  resignDate?: string | null;
}

export interface IUpdateEmployeePayload {
  name?: string;
  phone?: string;
  address?: string;
  joinDate?: string;
  /// Explicit null un-resigns someone who was marked as having left.
  resignDate?: string | null;
}

export interface ICreateEmployeeTransactionPayload {
  employeeId: string;
  cashAccountId: string;
  type: EmployeePayoutType;
  amount: number;
  /// Days covered — only meaningful on a salary.
  totalDays?: number;
  date?: string;
  note?: string;
}

export interface ICreateAttendancePayload {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  startTime?: string;
  endTime?: string;
  note?: string;
}
