-- CreateEnum
CREATE TYPE "AppStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('CREATED', 'SOLVED', 'DELETED');

-- CreateTable
CREATE TABLE "App" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "packageName" TEXT NOT NULL,
    "status" "AppStatus" NOT NULL DEFAULT 'PLANNED',
    "logo" TEXT NOT NULL,
    "banner" TEXT NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppIssue" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'CREATED',
    "appId" INTEGER NOT NULL,

    CONSTRAINT "AppIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameOriginal" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppTranslation" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER NOT NULL,
    "languageId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "AppTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mod" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "files" TEXT[],

    CONSTRAINT "Mod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModVersion" (
    "version" TEXT NOT NULL,

    CONSTRAINT "ModVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "_AppToMod" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_AppToMod_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ModToModVersion" (
    "A" INTEGER NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ModToModVersion_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "App_packageName_key" ON "App"("packageName");

-- CreateIndex
CREATE UNIQUE INDEX "Language_code_key" ON "Language"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AppTranslation_appId_languageId_key" ON "AppTranslation"("appId", "languageId");

-- CreateIndex
CREATE INDEX "_AppToMod_B_index" ON "_AppToMod"("B");

-- CreateIndex
CREATE INDEX "_ModToModVersion_B_index" ON "_ModToModVersion"("B");

-- AddForeignKey
ALTER TABLE "AppIssue" ADD CONSTRAINT "AppIssue_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppTranslation" ADD CONSTRAINT "AppTranslation_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppTranslation" ADD CONSTRAINT "AppTranslation_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AppToMod" ADD CONSTRAINT "_AppToMod_A_fkey" FOREIGN KEY ("A") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AppToMod" ADD CONSTRAINT "_AppToMod_B_fkey" FOREIGN KEY ("B") REFERENCES "Mod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ModToModVersion" ADD CONSTRAINT "_ModToModVersion_A_fkey" FOREIGN KEY ("A") REFERENCES "Mod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ModToModVersion" ADD CONSTRAINT "_ModToModVersion_B_fkey" FOREIGN KEY ("B") REFERENCES "ModVersion"("version") ON DELETE CASCADE ON UPDATE CASCADE;
