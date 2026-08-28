CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INACTIVE');
CREATE TABLE "forms" ("id" UUID NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "status" "FormStatus" NOT NULL DEFAULT 'DRAFT', "currentVersionId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "forms_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "forms_code_key" ON "forms"("code");
CREATE UNIQUE INDEX "forms_currentVersionId_key" ON "forms"("currentVersionId");
CREATE TABLE "form_versions" ("id" UUID NOT NULL, "formId" UUID NOT NULL, "versionNumber" INTEGER NOT NULL, "schemaJson" JSONB NOT NULL, "publishedAt" TIMESTAMP(3), "createdById" UUID, "changeReason" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "form_versions_formId_versionNumber_key" ON "form_versions"("formId", "versionNumber");
CREATE INDEX "form_versions_formId_active_idx" ON "form_versions"("formId", "active");
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "forms" ADD CONSTRAINT "forms_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "form_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
