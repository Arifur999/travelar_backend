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

  paginate(): this {
    this.page = Number(this.queryParams.page) || 1;
    this.limit = Number(this.queryParams.limit) || 10;
    this.skip = (this.page - 1) * this.limit;

    this.query.skip = this.skip;
    this.query.take = this.limit;
    return this;
  }

  sort(): this {
    this.sortBy = this.queryParams.sortBy || "createdAt";
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
