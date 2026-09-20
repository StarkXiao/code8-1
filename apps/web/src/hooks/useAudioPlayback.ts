import { useCallback } from 'react';
import type { AudioAttachmentDto, AudioClipDto } from '@froa/shared';
import { audioApi } from '../api/endpoints';
import { tokenStore } from '../api/client';
import { usePlayerStore } from '../store/player';

/**
 * "听原声"的统一入口。
 *
 * 规格卡片、步骤、条目详情都调它，因此"点一下就回到当时那句话"
 * 在全站行为一致，不会有某个页面忘了带片段区间。
 */
export function useAudioPlayback() {
  const play = usePlayerStore((s) => s.play);

  const playAudio = useCallback(
    (audio: AudioAttachmentDto | null | undefined, options?: { startMs?: number; endMs?: number; label?: string }) => {
      if (!audio) return;
      play({
        audioId: audio.id,
        src: audioApi.streamUrl(audio.id, tokenStore.access),
        startMs: options?.startMs,
        endMs: options?.endMs,
        label: options?.label,
      });
    },
    [play],
  );

  const playClip = useCallback(
    (clip: AudioClipDto | null | undefined, audio: AudioAttachmentDto | null | undefined, label?: string) => {
      if (!clip || !audio) return;
      playAudio(audio, {
        startMs: clip.startMs,
        endMs: clip.endMs,
        label: label ?? clip.label ?? '原声片段',
      });
    },
    [playAudio],
  );

  return { playAudio, playClip };
}
