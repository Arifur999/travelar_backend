import {
  IQueryConfig,
  IQueryResult,
  IqueryParams,
  PrismaCountArgs,
  PrismaFindManyArgs,
  PrismaModelDelegate,
} from "../interfaces/query.interface.js";

// Query-string params that control the shape of the response rather than
// filtering it — they must never be turned into a where clause.
const EXCLUDED_FIELDS = ["searchTerm", "page", "limit", "sortBy", "sortOrder", "fields", "include"];

const SCALAR_OPERATORS = ["lt", "lte", "gt", "gte", "equals", "not", "contains", "startsWith", "endsWith"];
const ARRAY_OPERATORS = ["in", "notIn"];

export const DEFAULT_PAGE_SIZE = 10;
/**
 * The largest page any caller gets. Without a ceiling, `?limit=10000000` made
 * one request load a whole table.
 *
 * 200 exactly, because the web app asks for `limit=200` to fill its dropdowns
 * (airlines, routes, visa agents, Hajj packages and batches). A lower cap would
 * silently cut those lists short.
 */
export const MAX_PAGE_SIZE = 200;
/** Prisma's `skip` is a 32-bit integer; a page past this could not be expressed. */
const MAX_SKIP = 2_000_000_000;

/** A positive whole number, or the fallback. "2.5", "-1", "0" and "abc" all fall back. */
const positiveInteger = (value: unknown, fallback: number) => {
  const parsed = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** `field` or `relation.field` — anything else is not a sort key. */
const SORT_KEY = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export class QueryBuilder<
  T,
  TWhereInput = Record<string, unknown>,
  TInclude = Record<string, unknown>,
> {
  private query: PrismaFindManyArgs;
  private countQuery: PrismaCountArgs;
  private page = 1;
  private limit = 10;
  private skip = 0;
  private sortBy = "createdAt";
  private sortOrder: "asc" | "desc" = "desc";
  private selectFields: Record<string, boolean> | undefined;

  constructor(
    private model: PrismaModelDelegate,
    private queryParams: IqueryParams,
    private config: IQueryConfig = {},
  ) {
    this.query = { where: {}, include: {}, orderBy: {}, skip: 0, take: 10 };
    this.countQuery = { where: {} };
  }

  // Both where objects are kept in lockstep. If they ever drift, the pagination
  // total stops matching the filtered rows and the last page renders empty.
  private mergeWhere(condition: Record<string, unknown>) {
    this.query.where = this.deepMerge(this.query.where ?? {}, condition);
    this.countQuery.where = this.deepMerge(this.countQuery.where ?? {}, condition);
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    const output: Record<string, unknown> = { ...target };

    for (const [key, value] of Object.entries(source)) {
      const existing = output[key];
      if (
        existing && typeof existing === "object" && !Array.isArray(existing) &&
        value && typeof value === "object" && !Array.isArray(value)
      ) {
        output[key] = this.deepMerge(
          existing as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        output[key] = value;
      }
    }

    return output;
  }

  // A dotted path is a relation hop: "customer.name" filters through the
  // relation rather than on a column literally called "customer.name".
  private buildNestedCondition(path: string[], leaf: unknown): Record<string, unknown> {
    if (path.length === 1) {
      return { [path[0]!]: leaf };
    }
    if (path.length === 2) {
      return { [path[0]!]: { [path[1]!]: leaf } };
    }
    return { [path[0]!]: { [path[1]!]: { [path[2]!]: leaf } } };
  }

  private parseFilterValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return { in: value.map((item) => this.parseFilterValue(item)) };
    }
    if (value === "true") return true;
    if (value === "false") return false;
    if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
      return Number(value);
    }
    return value;
  }

  // Range filters arrive as objects thanks to the `qs` query parser in app.ts,
  // e.g. ?fare[gte]=500 -> { fare: { gte: "500" } }. Unknown operators are
  // dropped rather than passed through to Prisma.
  private parseRangeFilter(value: Record<string, unknown>): unknown {
    const parsed: Record<string, unknown> = {};

    for (const [operator, operand] of Object.entries(value)) {
      if (SCALAR_OPERATORS.includes(operator)) {
        parsed[operator] = this.parseFilterValue(operand);
      } else if (ARRAY_OPERATORS.includes(operator)) {
        const list = Array.isArray(operand) ? operand : [operand];
        parsed[operator] = list.map((item) => this.parseFilterValue(item));
      }
    }

    return Object.keys(parsed).length > 0 ? parsed : value;
  }

  search(): this {
    const searchTerm = this.queryParams.searchTerm;
    const searchableFields = this.config.searchableFields ?? [];

    if (!searchTerm || searchableFields.length === 0) return this;

    const searchConditions = searchableFields.map((field) => {
      const leaf = { contains: searchTerm, mode: "insensitive" };
      const path = field.split(".");

      if (path.length === 1) return { [path[0]!]: leaf };
      if (path.length === 2) return { [path[0]!]: { [path[1]!]: leaf } };
      return { [path[0]!]: { [path[1]!]: { [path[2]!]: leaf } } };
    });

    this.mergeWhere({ OR: searchConditions });
    return this;
  }

  filter(): this {
    const filterableFields = this.config.filterableFields ?? [];

    for (const [key, value] of Object.entries(this.queryParams)) {
      if (EXCLUDED_FIELDS.includes(key)) continue;
      if (value === undefined || value === "") continue;
      // An empty whitelist means "allow all"; a populated one is authoritative.
      if (filterableFields.length > 0 && !filterableFields.includes(key)) continue;

      const path = key.split(".");
      const leaf =
        value && typeof value === "object" && !Array.isArray(value)
          ? this.parseRangeFilter(value as Record<string, unknown>)
          : this.parseFilterValue(value);

      this.mergeWhere(this.buildNestedCondition(path, leaf));
    }

    return this;
  }

  /// Server-side constraints the client cannot override — tenant scoping,
  /// soft-delete filters. Always prefer this over trusting a query param.
  where(condition: TWhereInput): this {
    this.mergeWhere(condition as Record<string, unknown>);
    return this;
  }

  include(relation: TInclude): this {
    if (this.selectFields) return this;
    this.query.include = { ...(this.query.include ?? {}), ...(relation as Record<string, unknown>) };
    return this;
  }

  /// Client-selectable relations via ?include=a,b. The whitelist is a SECURITY
  /// BOUNDARY: anything listed here is readable by every caller the route
  /// admits, so never whitelist a relation carrying data they shouldn't see.
  dynamicInclude(
    includeConfig: Record<string, unknown>,
    defaultInclude?: string[],
  ): this {
    if (this.selectFields) return this;

    const resolved: Record<string, unknown> = {};

    for (const name of defaultInclude ?? []) {
      if (name in includeConfig) resolved[name] = includeConfig[name];
    }

    const requested = this.queryParams.include;
    if (typeof requested === "string" && requested.trim() !== "") {
      for (const name of requested.split(",").map((item) => item.trim())) {
        if (name in includeConfig) resolved[name] = includeConfig[name];
      }
    }

    this.query.include = { ...(this.query.include ?? {}), ...resolved };
    return this;
  }

  // Paging comes straight from the query string, so it is normalised here:
  // `page=-1` used to reach Prisma as a negative skip and answer 500,
  // `limit=-5` returned rows with totalPages -2, and nothing capped the size.
  paginate(): this {
    this.limit = Math.min(positiveInteger(this.queryParams.limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    this.page = Math.min(positiveInteger(this.queryParams.page, 1), Math.floor(MAX_SKIP / this.limit) + 1);
    this.skip = (this.page - 1) * this.limit;

    this.query.skip = this.skip;
    this.query.take = this.limit;
    return this;
  }

  // A sortBy naming a column the model lacks still reaches Prisma, which
  // refuses it; globalErrorHandler turns that into a plain 400.
  sort(): this {
    const requested = typeof this.queryParams.sortBy === "string" ? this.queryParams.sortBy.trim() : "";
    this.sortBy = SORT_KEY.test(requested) ? requested : "createdAt";
    this.sortOrder = this.queryParams.sortOrder === "asc" ? "asc" : "desc";

    const path = this.sortBy.split(".");
    this.query.orderBy =
      path.length === 1
        ? { [path[0]!]: this.sortOrder }
        : { [path[0]!]: { [path[1]!]: this.sortOrder } };

    return this;
  }

  /// Must be chained LAST: Prisma rejects select and include together, so this
  /// deletes any include the previous calls set up.
  fields(): this {
    const fields = this.queryParams.fields;
    if (typeof fields !== "string" || fields.trim() === "") return this;

    this.selectFields = {};
    for (const field of fields.split(",").map((item) => item.trim())) {
      if (field) this.selectFields[field] = true;
    }

    this.query.select = this.selectFields;
    delete this.query.include;
    return this;
  }

  getQuery(): PrismaFindManyArgs {
    return this.query;
  }

  async count(): Promise<number> {
    return this.model.count(this.countQuery as Parameters<typeof this.model.count>[0]);
  }

  async execute(): Promise<IQueryResult<T>> {
    const [total, data] = await Promise.all([
      this.model.count(this.countQuery as Parameters<typeof this.model.count>[0]),
      this.model.findMany(this.query as Parameters<typeof this.model.findMany>[0]),
    ]);

    return {
      data: data as T[],
      meta: {
        page: this.page,
        limit: this.limit,
        total,
        totalPages: Math.ceil(total / this.limit),
      },
    };
  }
}
