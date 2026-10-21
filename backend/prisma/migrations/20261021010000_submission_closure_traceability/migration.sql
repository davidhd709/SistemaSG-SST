ALTER TABLE "form_submissions"
  ADD COLUMN "closedByUserId" UUID,
  ADD COLUMN "closureNotes" TEXT;

WITH latest_close AS (
  SELECT DISTINCT ON ("entityId")
    "entityId",
    "actorUserId",
    reason,
    action
  FROM "audit_events"
  WHERE "entityType" = 'FORM_SUBMISSION'
    AND action IN ('CLOSE_WORKDAY', 'ADMIN_CLOSE_WORKDAY')
  ORDER BY "entityId", "createdAt" DESC
)
UPDATE "form_submissions" AS submission
SET
  "closureNotes" = latest_close.reason,
  "closedByUserId" = CASE
    WHEN latest_close.action = 'ADMIN_CLOSE_WORKDAY' THEN latest_close."actorUserId"
    ELSE NULL
  END
FROM latest_close
WHERE submission.id::text = latest_close."entityId";

CREATE INDEX "form_submissions_closedByUserId_idx" ON "form_submissions"("closedByUserId");

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_closedByUserId_fkey"
  FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
