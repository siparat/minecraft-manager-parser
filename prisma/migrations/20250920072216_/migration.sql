/*
  Warnings:

  - Added the required column `category` to the `Mod` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ModCategory" AS ENUM ('ADDON', 'WORLD', 'TEXTURE_PACK', 'SKIN_PACK');

-- AlterTable
ALTER TABLE "Mod" ADD COLUMN     "category" "ModCategory" NOT NULL,
ADD COLUMN     "commentCounts" INTEGER,
ADD COLUMN     "rating" DOUBLE PRECISION;
