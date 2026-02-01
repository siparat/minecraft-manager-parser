/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `Policy` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Policy_slug_key" ON "Policy"("slug");
