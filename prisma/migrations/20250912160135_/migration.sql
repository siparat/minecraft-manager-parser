/*
  Warnings:

  - A unique constraint covering the columns `[parsedSlug]` on the table `Mod` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "App" ADD COLUMN     "appScreenshots" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "AppSdk" ADD COLUMN     "thirdInterCode" TEXT,
ADD COLUMN     "thirdNativeCode" TEXT,
ADD COLUMN     "thirdOpenCode" TEXT;

-- AlterTable
ALTER TABLE "Mod" ADD COLUMN     "htmlDescription" TEXT,
ADD COLUMN     "parsedSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Mod_parsedSlug_key" ON "Mod"("parsedSlug");
