-- CreateEnum
CREATE TYPE "ImportStage" AS ENUM ('FOUNDATIONS', 'HISTORY');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('COMPLETED', 'REVERTED');

-- CreateTable
CREATE TABLE "data_imports" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "stage" "ImportStage" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'COMPLETED',
    "counts" JSONB NOT NULL,
    "revertedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_records" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceTab" TEXT,
    "sourceRow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_imports_agencyId_idx" ON "data_imports"("agencyId");

-- CreateIndex
CREATE INDEX "data_imports_agencyId_createdAt_idx" ON "data_imports"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "imported_records_importId_idx" ON "imported_records"("importId");

-- CreateIndex
CREATE INDEX "imported_records_agencyId_entity_idx" ON "imported_records"("agencyId", "entity");

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_records" ADD CONSTRAINT "imported_records_importId_fkey" FOREIGN KEY ("importId") REFERENCES "data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
