-- CreateTable
CREATE TABLE "ModTranslation" (
    "id" SERIAL NOT NULL,
    "modId" INTEGER NOT NULL,
    "languageId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "ModTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModTranslation_modId_languageId_key" ON "ModTranslation"("modId", "languageId");

-- AddForeignKey
ALTER TABLE "ModTranslation" ADD CONSTRAINT "ModTranslation_modId_fkey" FOREIGN KEY ("modId") REFERENCES "Mod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModTranslation" ADD CONSTRAINT "ModTranslation_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE CASCADE ON UPDATE CASCADE;
