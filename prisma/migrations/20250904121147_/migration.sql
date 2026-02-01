/*
  Warnings:

  - Added the required column `email` to the `AppIssue` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "App" ADD COLUMN     "apk" TEXT,
ADD COLUMN     "bundle" TEXT;

-- AlterTable
ALTER TABLE "AppIssue" ADD COLUMN     "email" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Mod" ADD COLUMN     "descriptionImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isParsed" BOOLEAN DEFAULT false;
