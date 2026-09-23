-- An import run now outlives the request that started it: it has a state while
-- it works, somewhere to say how far it has got, and the file's hash, so the
-- same workbook uploaded twice is recognised before anything is written.
ALTER TYPE "ImportStage" ADD VALUE IF NOT EXISTS 'EVERYTHING';

ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'RUNNING';
ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TABLE "data_imports"
  ADD COLUMN "fileHash" TEXT,
  ADD COLUMN "progress" JSONB,
  ADD COLUMN "result" JSONB,
  ALTER COLUMN "status" SET DEFAULT 'RUNNING';

CREATE INDEX "data_imports_agencyId_fileHash_idx" ON "data_imports"("agencyId", "fileHash");
