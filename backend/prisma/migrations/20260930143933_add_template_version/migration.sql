-- AlterTable
ALTER TABLE "form_submissions" ADD COLUMN     "templateVersion" TEXT;

-- AlterTable
ALTER TABLE "height_certificates" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "job_positions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "social_security_payrolls" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "submission_members" ALTER COLUMN "id" DROP DEFAULT;
