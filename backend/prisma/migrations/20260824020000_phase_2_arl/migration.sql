CREATE TABLE "arl_affiliations" (
  "id" UUID NOT NULL, "collaboratorId" UUID NOT NULL, "providerName" TEXT NOT NULL, "startDate" DATE NOT NULL, "endDate" DATE NOT NULL,
  "createdById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedById" UUID, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "arl_affiliations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "arl_affiliations_collaboratorId_endDate_idx" ON "arl_affiliations"("collaboratorId", "endDate");
CREATE INDEX "arl_affiliations_endDate_idx" ON "arl_affiliations"("endDate");
CREATE TABLE "file_objects" (
  "id" UUID NOT NULL, "storageProvider" TEXT NOT NULL, "bucket" TEXT NOT NULL, "objectKey" TEXT NOT NULL, "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "sha256" TEXT NOT NULL, "createdById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "file_objects_objectKey_key" ON "file_objects"("objectKey");
CREATE TABLE "arl_documents" ("id" UUID NOT NULL, "affiliationId" UUID NOT NULL, "fileId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "arl_documents_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "arl_documents_affiliationId_fileId_key" ON "arl_documents"("affiliationId", "fileId");
ALTER TABLE "arl_affiliations" ADD CONSTRAINT "arl_affiliations_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "arl_affiliations" ADD CONSTRAINT "arl_affiliations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "arl_affiliations" ADD CONSTRAINT "arl_affiliations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "arl_documents" ADD CONSTRAINT "arl_documents_affiliationId_fkey" FOREIGN KEY ("affiliationId") REFERENCES "arl_affiliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "arl_documents" ADD CONSTRAINT "arl_documents_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
