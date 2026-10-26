-- Firma registrada de Coordinación, firma fijada en cada aprobación y firma
-- de término de los integrantes para los formatos ATS, eléctrico y escalera.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "signatureFileId" UUID,
ADD COLUMN     "signatureUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "submission_members" ADD COLUMN     "closingSignatureId" UUID;

-- AlterTable
ALTER TABLE "approvals" ADD COLUMN     "signatureFileId" UUID,
ADD COLUMN     "signerName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_signatureFileId_key" ON "users"("signatureFileId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_members_closingSignatureId_key" ON "submission_members"("closingSignatureId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_signatureFileId_fkey" FOREIGN KEY ("signatureFileId") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_members" ADD CONSTRAINT "submission_members_closingSignatureId_fkey" FOREIGN KEY ("closingSignatureId") REFERENCES "signatures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_signatureFileId_fkey" FOREIGN KEY ("signatureFileId") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
