import { pgTable, uuid, varchar, integer, timestamp, boolean, uniqueIndex, index, bigint, primaryKey } from "drizzle-orm/pg-core";

export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  monthlyAllowance: integer("monthly_allowance").notNull(),
  maxUnitsPerRequest: integer("max_units_per_request").notNull(),
  isPredefined: boolean("is_predefined").notNull(),
  accountId: uuid("account_id").references(() => accounts.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  apiKeyHash: varchar("api_key_hash", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    externalId: varchar("external_id", { length: 255 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_users_account_external_id").on(
      table.accountId,
      table.externalId,
    ),
  ],
);

export const accountPlanAssignments = pgTable(
  "account_plan_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export const userPlanAssignments = pgTable(
  "user_plan_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);


export const accountMonthlyUsage = pgTable(
  "account_monthly_usage",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    billingMonth: varchar("billing_month", { length: 7 }).notNull(),
    consumedUnits: bigint("consumed_units", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.billingMonth],
    }),
    index("idx_account_monthly_usage_month").on(table.billingMonth),
  ],
);

export const userMonthlyUsage = pgTable(
  "user_monthly_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    billingMonth: varchar("billing_month", { length: 7 }).notNull(),

    consumedUnits: bigint("consumed_units", { mode: "number" })
      .notNull()
      .default(0),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.billingMonth],
    }),
    index("idx_user_monthly_usage_month").on(table.billingMonth),
  ],
);

export const usageRequests = pgTable(
  "usage_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    requestId: varchar("request_id", { length: 255 }).notNull(),

    units: bigint("units", { mode: "number" }).notNull(),

    status: varchar("status", { length: 20 }).notNull(), // 'ACCEPTED', 'REJECTED'

    rejectionReason: varchar("rejection_reason", { length: 255 }),

    rejectionScope: varchar("rejection_scope", { length: 20 }), // 'account', 'user', 'none'

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // ضمان عدم تكرار الـ requestId لنفس الحساب لتطبيق الـ Idempotency بأمان
    uniqueIndex("idx_account_request_id").on(table.accountId, table.requestId),
    // فهرس لتسريع البحث في تاريخ الطلبات
    index("idx_usage_requests_account_created").on(table.accountId, table.createdAt),
  ],
);
