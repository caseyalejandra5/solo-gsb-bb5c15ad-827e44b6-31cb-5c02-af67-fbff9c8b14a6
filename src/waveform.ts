/**
 * 音频波形解码：选择本地视频后，用 Web Audio API 在浏览器内解码音轨，
 * 按固定时间桶（每桶 10ms）计算正/负峰值。结果只保存在内存中，
 * 切换视频时由调用方丢弃并等待垃圾回收。
 */

/** 固定时间桶：每秒 100 桶，每桶 10ms */
export const BUCKETS_PER_SEC = 100;
export const BUCKET_SEC = 1 / BUCKETS_PER_SEC;

export interface WavePeaks {
  /** 每个桶的负向峰值（<=0） */
  min: Float32Array;
  /** 每个桶的正向峰值（>=0） */
  max: Float32Array;
  /** 桶数量 */
  bucketCount: number;
  /** 解码出的音频时长（秒），用于与视频时间轴对齐 */
  durationSec: number;
  sampleRate: number;
}

/** 视频没有可用音轨（或音轨为全静音） */
export class NoAudioError extends Error {
  constructor(message = '该视频不包含可解码的音轨') {
    super(message);
    this.name = 'NoAudioError';
  }
}

/** 当前浏览器不支持 Web Audio API */
export class UnsupportedAudioError extends Error {
  constructor(message = '当前浏览器不支持 Web Audio API') {
    super(message);
    this.name = 'UnsupportedAudioError';
  }
}

export type WaveStatus = 'idle' | 'decoding' | 'ready' | 'no-audio' | 'error';

export type WaveState =
  | { status: 'idle' }
  | { status: 'decoding' }
  | { status: 'ready'; peaks: WavePeaks }
  | { status: 'no-audio' }
  | { status: 'error'; message: string; retryable: boolean };

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
  return w.webkitAudioContext ?? null;
}

/**
 * 解码文件音轨并按固定 10ms 桶聚合正负峰值。
 * 失败时抛出 NoAudioError / DOMException（编码不支持或解码失败）等，调用方可重试。
 */
export async function decodeAudioPeaks(file: File): Promise<WavePeaks> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) throw new UnsupportedAudioError();

  const arrayBuf = await file.arrayBuffer();
  const ctx = new Ctor();
  let audioBuf: AudioBuffer;
  try {
    // decodeAudioData 会 detach arrayBuf；上下文仅用于解码，解码后立即关闭释放资源
    audioBuf = await ctx.decodeAudioData(arrayBuf);
  } finally {
    void ctx.close();
  }

  const channels = audioBuf.numberOfChannels;
  if (channels === 0) throw new NoAudioError('该视频不包含音轨');

  const sampleRate = audioBuf.sampleRate;
  const samplesPerBucket = Math.max(1, Math.round(sampleRate * BUCKET_SEC));
  const bucketCount = Math.max(1, Math.ceil(audioBuf.length / samplesPerBucket));
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(audioBuf.getChannelData(ch));

  let globalMaxAbs = 0;
  for (let b = 0; b < bucketCount; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(audioBuf.length, start + samplesPerBucket);
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      // 多声道取同一时刻各声道中绝对值最大者
      let v = Math.abs(channelData[0][i]);
      let sample = channelData[0][i];
      for (let ch = 1; ch < channels; ch++) {
        const s = channelData[ch][i];
        const a = Math.abs(s);
        if (a > v) {
          v = a;
          sample = s;
        }
      }
      if (sample < lo) lo = sample;
      else if (sample > hi) hi = sample;
    }
    min[b] = lo;
    max[b] = hi;
    if (-lo > globalMaxAbs) globalMaxAbs = -lo;
    if (hi > globalMaxAbs) globalMaxAbs = hi;
  }

  // 部分浏览器对无音轨视频会返回全 0 缓冲，按无音轨处理
  if (globalMaxAbs < 1e-4) {
    throw new NoAudioError('该视频的音轨为静音或不存在');
  }

  return {
    min,
    max,
    bucketCount,
    durationSec: audioBuf.duration,
    sampleRate,
  };
}

/** 把解码异常转换为可展示、可恢复的提示文案 */
export function describeWaveError(err: unknown): { message: string; retryable: boolean } {
  if (err instanceof UnsupportedAudioError) {
    return {
      message: '当前浏览器不支持 Web Audio 解码，无法生成波形（不影响字幕编辑）',
      retryable: false,
    };
  }
  if (err instanceof DOMException && err.name === 'NotSupportedError') {
    return {
      message: '浏览器不支持该视频的音频编码，可更换浏览器或转码后重试',
      retryable: true,
    };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { message: `音频解码失败：${detail}`, retryable: true };
}
