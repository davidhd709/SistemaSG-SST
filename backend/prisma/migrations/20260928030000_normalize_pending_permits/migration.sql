-- Pending permits were previously stamped as started when they were submitted.
-- Their submission timestamp remains available in submittedAt and audit events.
UPDATE "form_submissions"
SET "startedAt" = NULL,
    "workDate" = (("submittedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date,
    "answersJson" = CASE
      WHEN "answersJson" ? 'hora_inicio'
        THEN jsonb_set("answersJson", '{hora_inicio}', '"Pendiente de inicio"'::jsonb)
      ELSE "answersJson"
    END
WHERE "status" = 'PENDING_APPROVAL'
  AND "startedAt" IS NOT NULL
  AND "submittedAt" IS NOT NULL;
