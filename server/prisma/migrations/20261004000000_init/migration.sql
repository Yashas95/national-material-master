-- ==============================================================================
-- National Unified Material Master Framework (NUMMF) - Baseline Migration
-- ==============================================================================

-- Enable Vector and UUID Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "cpses" (
    "id" TEXT NOT NULL,
    "short" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "erp" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_records" (
    "id" TEXT NOT NULL,
    "cpse_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "raw_desc" TEXT NOT NULL,
    "norm_desc" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "attrs" JSONB NOT NULL,
    "unit" TEXT,
    "unit_family" TEXT,
    "unit_factor" DOUBLE PRECISION,
    "unit_canon" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Initial Dataset',
    "batch_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INGESTED',
    "embedding" vector(384),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legacy_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "national_materials" (
    "id" TEXT NOT NULL,
    "cluster_key" TEXT NOT NULL,
    "nmc_code" TEXT NOT NULL,
    "code_number" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "std_desc" TEXT NOT NULL,
    "critical_attrs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "notes" TEXT,
    "embedding" vector(384),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "national_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_mappings" (
    "id" TEXT NOT NULL,
    "national_material_id" TEXT NOT NULL,
    "legacy_record_id" TEXT NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "match_type" TEXT NOT NULL,
    "explanation" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_versions" (
    "id" TEXT NOT NULL,
    "national_material_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "std_desc" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "change_reason" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_history" (
    "id" TEXT NOT NULL,
    "legacy_record_id" TEXT NOT NULL,
    "po_number" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "supplier" TEXT NOT NULL,
    "po_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_opportunities" (
    "id" TEXT NOT NULL,
    "national_material_id" TEXT NOT NULL,
    "combined_demand" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "price_min" DOUBLE PRECISION NOT NULL,
    "price_max" DOUBLE PRECISION NOT NULL,
    "price_spread_pct" DOUBLE PRECISION NOT NULL,
    "participating_cpses" JSONB NOT NULL,
    "shared_suppliers" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "extra" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_configs" (
    "id" TEXT NOT NULL DEFAULT 'active',
    "weights" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legacy_records_category_idx" ON "legacy_records"("category");
CREATE INDEX "legacy_records_status_idx" ON "legacy_records"("status");
CREATE INDEX "legacy_records_cpse_id_idx" ON "legacy_records"("cpse_id");
CREATE UNIQUE INDEX "legacy_records_cpse_id_code_key" ON "legacy_records"("cpse_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "national_materials_cluster_key_key" ON "national_materials"("cluster_key");
CREATE UNIQUE INDEX "national_materials_nmc_code_key" ON "national_materials"("nmc_code");
CREATE UNIQUE INDEX "national_materials_code_number_key" ON "national_materials"("code_number");
CREATE INDEX "national_materials_category_idx" ON "national_materials"("category");
CREATE INDEX "national_materials_status_idx" ON "national_materials"("status");

-- CreateIndex
CREATE UNIQUE INDEX "material_mappings_legacy_record_id_key" ON "material_mappings"("legacy_record_id");
CREATE INDEX "material_mappings_national_material_id_idx" ON "material_mappings"("national_material_id");
CREATE INDEX "material_mappings_status_idx" ON "material_mappings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "material_versions_national_material_id_version_key" ON "material_versions"("national_material_id", "version");

-- CreateIndex
CREATE INDEX "procurement_history_legacy_record_id_idx" ON "procurement_history"("legacy_record_id");
CREATE INDEX "procurement_history_supplier_idx" ON "procurement_history"("supplier");

-- CreateIndex
CREATE INDEX "procurement_opportunities_national_material_id_idx" ON "procurement_opportunities"("national_material_id");
CREATE INDEX "procurement_opportunities_score_idx" ON "procurement_opportunities"("score");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_target_idx" ON "audit_logs"("target");

-- AddForeignKey
ALTER TABLE "legacy_records" ADD CONSTRAINT "legacy_records_cpse_id_fkey" FOREIGN KEY ("cpse_id") REFERENCES "cpses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_mappings" ADD CONSTRAINT "material_mappings_national_material_id_fkey" FOREIGN KEY ("national_material_id") REFERENCES "national_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_mappings" ADD CONSTRAINT "material_mappings_legacy_record_id_fkey" FOREIGN KEY ("legacy_record_id") REFERENCES "legacy_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_national_material_id_fkey" FOREIGN KEY ("national_material_id") REFERENCES "national_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_history" ADD CONSTRAINT "procurement_history_legacy_record_id_fkey" FOREIGN KEY ("legacy_record_id") REFERENCES "legacy_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_national_material_id_fkey" FOREIGN KEY ("national_material_id") REFERENCES "national_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW Vector Indexes
CREATE INDEX IF NOT EXISTS legacy_records_embedding_hnsw_idx 
ON legacy_records USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS national_materials_embedding_hnsw_idx 
ON national_materials USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
