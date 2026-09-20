-- AlterTable
ALTER TABLE "AudioAttachment" ADD COLUMN "transcriptUpdatedAt" DATETIME;

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "audioAttachmentId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TranscriptSegment_audioAttachmentId_fkey" FOREIGN KEY ("audioAttachmentId") REFERENCES "AudioAttachment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_audioAttachmentId_orderIndex_key" ON "TranscriptSegment"("audioAttachmentId", "orderIndex");

-- CreateIndex
CREATE INDEX "TranscriptSegment_audioAttachmentId_idx" ON "TranscriptSegment"("audioAttachmentId");
