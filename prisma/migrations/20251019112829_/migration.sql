/*
  Warnings:

  - You are about to drop the `_AppToMod` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateTable
CREATE TABLE "AppMod" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER NOT NULL,
    "modId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AppMod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppMod_appId_modId_key" ON "AppMod"("appId", "modId");

-- AddForeignKey
ALTER TABLE "AppMod" ADD CONSTRAINT "AppMod_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppMod" ADD CONSTRAINT "AppMod_modId_fkey" FOREIGN KEY ("modId") REFERENCES "Mod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
