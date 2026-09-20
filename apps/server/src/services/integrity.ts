import fs from 'node:fs';
import { prisma } from '../db/client';
import { logger } from '../lib/logger';
import { storage } from './storage';

export interface IntegrityReport {
  checked: number;
  missingFiles: { audioId: string; storagePath: string }[];
  checksumMismatch: { audioId: string; storagePath: string }[];
  orphanFiles: number;
}

/**
 * 音频完整性巡检。
 *
 * 音频是全部结论的证据，所以必须有"发现丢失"的能力，而不是等用户点开才发现放不出来。
 * 默认关闭（INTEGRITY_SCAN_INTERVAL_MIN=0），生产建议开启。
 */
export async function runIntegrityScan(verifyChecksums = false): Promise<IntegrityReport> {
  // 扫描**全部**音频（含软删除的）：软删除只是从语音库里隐藏，
  // 文件本身仍然被保留、仍可能被某条结论引用，所以它同样不能丢。
  const audios = await prisma.audioAttachment.findMany({
    select: { id: true, storagePath: true, sha256: true },
  });

  const report: IntegrityReport = {
    checked: audios.length,
    missingFiles: [],
    checksumMismatch: [],
    orphanFiles: 0,
  };

  for (const audio of audios) {
    const exists = await storage().exists(audio.storagePath);
    if (!exists) {
      report.missingFiles.push({ audioId: audio.id, storagePath: audio.storagePath });
      continue;
    }
    if (!verifyChecksums) continue;

    try {
      const absolute = storage().absolutePath(audio.storagePath);
      if (!absolute) continue;
      const buffer = fs.readFileSync(absolute);
      const { sha256 } = await import('../lib/ids');
      if (sha256(buffer) !== audio.sha256) {
        report.checksumMismatch.push({ audioId: audio.id, storagePath: audio.storagePath });
      }
    } catch (error) {
      logger.warn({ err: error, audioId: audio.id }, '校验音频失败');
    }
  }

  if (report.missingFiles.length) {
    logger.error(
      { count: report.missingFiles.length, sample: report.missingFiles.slice(0, 5) },
      '音频完整性巡检发现文件缺失，请从备份恢复',
    );
  }
  if (report.checksumMismatch.length) {
    logger.error(
      { count: report.checksumMismatch.length, sample: report.checksumMismatch.slice(0, 5) },
      '音频完整性巡检发现校验和不一致',
    );
  }

  return report;
}

export function startIntegritySchedule(intervalMinutes: number): NodeJS.Timeout | null {
  if (!intervalMinutes || intervalMinutes <= 0) return null;
  const timer = setInterval(
    () => {
      void runIntegrityScan(true).catch((error) => logger.warn({ err: error }, '音频巡检失败'));
    },
    intervalMinutes * 60 * 1000,
  );
  timer.unref();
  return timer;
}
