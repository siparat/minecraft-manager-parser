-- DropForeignKey
ALTER TABLE "AppIssue" DROP CONSTRAINT "AppIssue_appId_fkey";

-- CreateTable
CREATE TABLE "AppSdk" (
    "appId" INTEGER NOT NULL,
    "isAdsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metricaToken" TEXT,
    "appLovinToken" TEXT,
    "adMobToken" TEXT,
    "firstOpenCode" TEXT,
    "firstInterCode" TEXT,
    "firstNativeCode" TEXT,
    "secondOpenCode" TEXT,
    "secondInterCode" TEXT,
    "secondNativeCode" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSdk_appId_key" ON "AppSdk"("appId");

-- AddForeignKey
ALTER TABLE "AppIssue" ADD CONSTRAINT "AppIssue_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSdk" ADD CONSTRAINT "AppSdk_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
