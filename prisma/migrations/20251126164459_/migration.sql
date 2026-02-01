/*
  Warnings:

  - You are about to drop the `_AppToMod` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_AppToMod" DROP CONSTRAINT "_AppToMod_A_fkey";

-- DropForeignKey
ALTER TABLE "_AppToMod" DROP CONSTRAINT "_AppToMod_B_fkey";

-- DropTable
DROP TABLE "_AppToMod";

-- CreateTable
CREATE TABLE "Policy" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);
