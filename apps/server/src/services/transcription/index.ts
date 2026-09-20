import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '../../config/env';
import { ApiError } from '../../lib/errors';
import { logger } from '../../lib/logger';

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  /** manual 驱动返回 empty=true，表示"等人工录入"而不是"转写失败" */
  empty: boolean;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: { path: string; mimeType: string }): Promise<TranscriptionResult>;
}

/**
 * 默认驱动：不调用任何外部服务。
 * 转写是加速器而不是必需项 —— 没有 ASR 也必须有完整可用的整理流程。
 */
class ManualProvider implements TranscriptionProvider {
  readonly name = 'manual';

  async transcribe(): Promise<TranscriptionResult> {
    return { text: '', segments: [], empty: true };
  }
}

/** 本地 whisper 可执行文件，例如 `pip install openai-whisper` 后的 whisper 命令 */
class WhisperLocalProvider implements TranscriptionProvider {
  readonly name = 'whisper-local';

  async transcribe({ path: filePath }: { path: string; mimeType: string }): Promise<TranscriptionResult> {
    if (!fs.existsSync(filePath)) throw new ApiError('ASR_UNAVAILABLE', '音频文件不存在');

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'froa-asr-'));
    try {
      await run(env.whisperBin, [
        filePath,
        '--model',
        env.whisperModel,
        '--output_format',
        'json',
        '--output_dir',
        outDir,
        '--verbose',
        'False',
      ]);

      const produced = fs.readdirSync(outDir).find((name) => name.endsWith('.json'));
      if (!produced) throw new ApiError('ASR_UNAVAILABLE', 'whisper 未产出转写结果');

      const raw = JSON.parse(fs.readFileSync(path.join(outDir, produced), 'utf8')) as {
        text?: string;
        segments?: { start: number; end: number; text: string }[];
      };

      const segments = (raw.segments ?? []).map((segment) => ({
        startMs: Math.round(segment.start * 1000),
        endMs: Math.round(segment.end * 1000),
        text: segment.text.trim(),
      }));

      return { text: (raw.text ?? '').trim(), segments, empty: false };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.warn({ err: error }, 'whisper-local 转写失败');
      throw new ApiError('ASR_UNAVAILABLE', `本地 whisper 执行失败：${(error as Error).message}`);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
}

/** 可选：OpenAI 转写接口 */
class OpenAIProvider implements TranscriptionProvider {
  readonly name = 'openai';

  async transcribe({ path: filePath, mimeType }: { path: string; mimeType: string }): Promise<TranscriptionResult> {
    if (!env.openaiApiKey) {
      throw new ApiError('ASR_UNAVAILABLE', '未配置 OPENAI_API_KEY');
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), path.basename(filePath));
    form.append('model', env.openaiTranscribeModel);
    form.append('response_format', 'verbose_json');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openaiApiKey}` },
      body: form,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ApiError('ASR_UNAVAILABLE', `转写接口返回 ${response.status}：${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      text?: string;
      segments?: { start: number; end: number; text: string }[];
    };

    const segments = (payload.segments ?? []).map((segment) => ({
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
      text: segment.text.trim(),
    }));

    return { text: (payload.text ?? '').trim(), segments, empty: false };
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-500) || `进程退出码 ${code}`));
    });
  });
}

export function transcriptionProvider(): TranscriptionProvider {
  switch (env.asrProvider) {
    case 'whisper-local':
      return new WhisperLocalProvider();
    case 'openai':
      return new OpenAIProvider();
    default:
      return new ManualProvider();
  }
}
