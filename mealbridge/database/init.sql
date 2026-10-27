CREATE TABLE IF NOT EXISTS mealbridge_schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Production tables are managed by Prisma migrations. Do not treat this
-- bootstrap marker as a complete production database schema.