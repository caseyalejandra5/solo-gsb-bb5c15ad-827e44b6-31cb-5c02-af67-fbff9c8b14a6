import { useEffect, useRef, useState, type RefObject } from 'react';
import { BUCKETS_PER_SEC, type WaveState } from '../waveform';

interface WaveformTrackProps {
  wave: WaveState;
  pxPerSec: number;
  scrollRef: RefObject<HTMLDivElement>;
  onSeek: (sec: number) => void;
  onRetry: () => void;
  onDismiss: () => void;
}

const ROW_HEIGHT = 64;

/**
 * 波形轨道：位于标尺与字幕块之间。
 * 画布使用 sticky 定位锁定在横向可视区内，缩放或横向滚动时只绘制当前可视时间窗口，
 * 波形、刻度、播放头共用 timeline-inner 的同一时间坐标（left = time * pxPerSec）。
 */
export default function WaveformTrack({
  wave,
  pxPerSec,
  scrollRef,
  onSeek,
  onRetry,
  onDismiss,
}: WaveformTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const scrubRef = useRef(false);
  const rafRef = useRef(0);

  // 绘制所需参数放进 ref，滚动回调无需重新绑定即可读到最新值
  const waveRef = useRef(wave);
  waveRef.current = wave;
  const pxRef = useRef(pxPerSec);
  pxRef.current = pxPerSec;

  // 监听横向滚动容器的可视宽度（画布 sticky 后只占可视区宽度）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  // 只绘制可视区：读取 scrollLeft 计算时间窗口，按桶取峰
  const draw = () => {
    const canvas = canvasRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !scroll) return;
    const state = waveRef.current;
    if (state.status !== 'ready') return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, scroll.clientWidth);
    const cssH = ROW_HEIGHT;
    const dW = Math.round(cssW * dpr);
    const dH = Math.round(cssH * dpr);
    if (canvas.width !== dW || canvas.height !== dH) {
      canvas.width = dW;
      canvas.height = dH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const scrollLeft = scroll.scrollLeft;
    const startSec = scrollLeft / pxRef.current;
    const endSec = (scrollLeft + cssW) / pxRef.current;
    const { min, max, bucketCount, durationSec } = state.peaks;

    // 中轴基线
    ctx.strokeStyle = 'rgba(139, 150, 173, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cssH / 2 + 0.5);
    ctx.lineTo(cssW, cssH / 2 + 0.5);
    ctx.stroke();

    // 波形填充：每个像素列覆盖若干时间桶，取窗口内极值
    ctx.fillStyle = '#5b9bff';
    const mid = cssH / 2;
    const amp = cssH / 2 - 4;
    const firstBucket = Math.max(0, Math.floor(startSec * BUCKETS_PER_SEC));
    const lastBucket = Math.min(bucketCount - 1, Math.ceil(endSec * BUCKETS_PER_SEC));
    for (let x = 0; x < cssW; x++) {
      const t0 = (scrollLeft + x) / pxRef.current;
      const t1 = (scrollLeft + x + 1) / pxRef.current;
      let b0 = Math.floor(t0 * BUCKETS_PER_SEC);
      const b1 = Math.min(bucketCount - 1, Math.ceil(t1 * BUCKETS_PER_SEC));
      if (b0 < firstBucket) b0 = firstBucket;
      let lo = 0;
      let hi = 0;
      for (let b = b0; b <= b1 && b <= lastBucket; b++) {
        if (min[b] < lo) lo = min[b];
        if (max[b] > hi) hi = max[b];
      }
      if (lo === 0 && hi === 0) continue;
      const yTop = mid - hi * amp;
      const yBot = mid - lo * amp;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
    }

    // 音频实际结束位置（与视频时长对齐后超出部分不绘制）
    const endX = durationSec * pxRef.current - scrollLeft;
    if (endX > 0 && endX < cssW) {
      ctx.strokeStyle = 'rgba(139, 150, 173, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(endX + 0.5, 4);
      ctx.lineTo(endX + 0.5, cssH - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  // 用 rAF 合并同一帧内的滚动/缩放/解码完成重绘
  const scheduleDraw = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', scheduleDraw, { passive: true });
    window.addEventListener('resize', scheduleDraw);
    return () => {
      el.removeEventListener('scroll', scheduleDraw);
      window.removeEventListener('resize', scheduleDraw);
      cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef]);

  // 解码完成、缩放或可视区宽度变化时重绘；横向滚动由 scroll 监听触发
  useEffect(() => {
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wave, pxPerSec, viewWidth]);

  const timeFromEvent = (e: React.PointerEvent) => {
    const scroll = scrollRef.current;
    if (!scroll) return 0;
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, (scroll.scrollLeft + (e.clientX - rect.left)) / pxPerSec);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || wave.status !== 'ready') return;
    e.stopPropagation();
    scrubRef.current = true;
    onSeek(timeFromEvent(e));
  };

  // 拖动 seek：与 Timeline 的全局 pointer 监听互不干扰
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const scroll = scrollRef.current;
      if (!scrubRef.current || !scroll) return;
      onSeek(Math.max(0, (scroll.scrollLeft + (e.clientX - scroll.getBoundingClientRect().left)) / pxRef.current));
    };
    const onUp = () => {
      scrubRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onSeek, pxPerSec, scrollRef]);

  const cursor = wave.status === 'ready' ? 'crosshair' : 'default';

  return (
    <div className="wave-row" style={{ height: ROW_HEIGHT, cursor }} onPointerDown={onPointerDown}>
      {wave.status === 'ready' && (
        <div className="wave-sticky" style={{ width: viewWidth || '100%' }}>
          <canvas ref={canvasRef} className="wave-canvas" style={{ height: ROW_HEIGHT }} />
        </div>
      )}

      {wave.status === 'decoding' && (
        <div className="wave-sticky wave-message" style={{ width: viewWidth || '100%' }}>
          <span className="wave-spinner" aria-hidden />
          <span>正在浏览器内解码音频并生成波形，请稍候…</span>
        </div>
      )}

      {wave.status === 'no-audio' && (
        <div className="wave-sticky wave-message" style={{ width: viewWidth || '100%' }}>
          <span className="wave-icon">🔇</span>
          <span>该视频没有可显示的音轨（或为全静音），字幕编辑不受影响</span>
          <button
            className="btn wave-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDismiss}
          >
            知道了
          </button>
        </div>
      )}

      {wave.status === 'error' && (
        <div className="wave-sticky wave-message" style={{ width: viewWidth || '100%' }}>
          <span className="wave-icon">⚠️</span>
          <span title={wave.message}>{wave.message}</span>
          {wave.retryable && (
            <button
              className="btn wave-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onRetry}
            >
              重试
            </button>
          )}
          <button
            className="btn wave-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDismiss}
          >
            关闭提示
          </button>
        </div>
      )}
    </div>
  );
}
