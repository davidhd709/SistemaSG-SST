-- Sedes: Alcalá ve la charla en video; en Montelíbano se da presencial.
CREATE TYPE "Site" AS ENUM ('MONTELIBANO', 'ALCALA');

-- Hasta ahora todos veían el video, así que los existentes quedan en Alcalá.
ALTER TABLE "collaborators" ADD COLUMN "site" "Site" NOT NULL DEFAULT 'ALCALA';
CREATE INDEX "collaborators_site_status_idx" ON "collaborators"("site", "status");

ALTER TABLE "form_submissions" ADD COLUMN "site" "Site";
UPDATE "form_submissions" AS submission
SET "site" = collaborator."site"
FROM "collaborators" AS collaborator
WHERE collaborator."id" = submission."collaboratorId";
CREATE INDEX "form_submissions_site_workDate_idx" ON "form_submissions"("site", "workDate");
