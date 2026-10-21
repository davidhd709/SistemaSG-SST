-- Vincula el cargo actual del colaborador al catálogo estructurado. La columna
-- de texto se conserva como copia de presentación y compatibilidad histórica.
ALTER TABLE "collaborators" ADD COLUMN "jobPositionId" UUID;

UPDATE "collaborators" AS collaborator
SET "jobPositionId" = position."id",
    "jobTitle" = position."name"
FROM "job_positions" AS position
WHERE lower(trim(collaborator."jobTitle")) = lower(trim(position."name"));

CREATE INDEX "collaborators_jobPositionId_idx" ON "collaborators"("jobPositionId");

ALTER TABLE "collaborators"
  ADD CONSTRAINT "collaborators_jobPositionId_fkey"
  FOREIGN KEY ("jobPositionId") REFERENCES "job_positions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
