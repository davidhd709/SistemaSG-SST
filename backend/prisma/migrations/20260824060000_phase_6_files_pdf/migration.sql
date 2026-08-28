ALTER TABLE "form_submissions" ADD COLUMN "finalPdfFileId" UUID;
CREATE UNIQUE INDEX "form_submissions_finalPdfFileId_key" ON "form_submissions"("finalPdfFileId");
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_finalPdfFileId_fkey" FOREIGN KEY ("finalPdfFileId") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
