-- En el modelo anterior un permiso aprobado era el final del proceso: no había
-- jornada que cerrar. Al introducir el cierre, esos envíos quedaron contando
-- como jornadas abiertas y bloqueaban al colaborador para siempre.
--
-- Se cierran con la fecha de su decisión, que es el momento real en que aquel
-- proceso terminó. Los envíos creados a partir de aquí sí registran su cierre.
UPDATE "form_submissions" s
   SET "status"   = 'CLOSED',
       "closedAt" = COALESCE(a."decidedAt", s."submittedAt", s."createdAt")
  FROM "approvals" a
 WHERE a."submissionId" = s."id"
   AND s."status" = 'APPROVED'
   AND s."closedAt" IS NULL;
