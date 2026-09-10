/* eslint-disable @typescript-eslint/no-explicit-any */

export type PrismaFindManyArgs = {
  where?: any;
  include?: any;
  select?: any;
  orderBy?: any;
  skip?: number;
  take?: number;
};

export type PrismaCountArgs = {
  where?: any;
};

export type PrismaModelDelegate = {
  findMany(args?: any): Promise<any>;
  count(args?: any): Promise<number>;
};

export interface IqueryParams {
  searchTerm?: string;
  page?: string | number;
  limit?: string | number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  fields?: string;
  include?: string;
  [key: string]: unknown;
}

export interface IQueryConfig {
  searchableFields?: string[];
  filterableFields?: string[];
}

export interface IQueryResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
