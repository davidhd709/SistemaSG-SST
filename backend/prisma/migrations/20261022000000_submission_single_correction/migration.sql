-- Un permiso rechazado se corrige una sola vez: el reenvío queda enlazado a su
-- intento anterior y la unicidad impide dos correcciones concurrentes.
CREATE UNIQUE INDEX "form_submissions_previousSubmissionId_key" ON "form_submissions"("previousSubmissionId");
