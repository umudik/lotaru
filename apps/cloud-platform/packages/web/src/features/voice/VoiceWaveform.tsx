import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type VoiceWaveformProps = {
  stream: MediaStream | null;
  active: boolean;
  className?: string;
};

type VoiceLevelBarsProps = {
  level: number;
  active: boolean;
  className?: string;
};

const BAR_WEIGHTS = [0.35, 0.55, 0.8, 1, 0.85, 0.6, 0.45, 0.3] as const;

export function VoiceLevelBars(props: VoiceLevelBarsProps): React.JSX.Element {
  if (props.active !== true) {
    return <span className={cn("block h-3.5 w-16", props.className)} aria-hidden="true" />;
  }
  return (
    <span
      className={cn("flex h-3.5 w-16 items-end justify-between gap-px", props.className)}
      aria-hidden="true"
    >
      {BAR_WEIGHTS.map((weight, index) => {
        const amp = Math.max(0.12, Math.min(1, props.level * weight * 1.4));
        return (
          <span
            key={index}
            className="w-[2px] rounded-sm bg-emerald-400 transition-[height] duration-75 ease-out"
            style={{ height: `${String(Math.round(amp * 100))}%` }}
          />
        );
      })}
    </span>
  );
}

export function VoiceWaveform(props: VoiceWaveformProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stream = props.stream;
    if (canvas === null || stream === null || props.active !== true) {
      return;
    }
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.7;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    const bins = new Uint8Array(analyser.fftSize);
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      void audioCtx.close();
      return;
    }
    let frame = 0;
    let alive = true;
    let lastPaint = 0;

    function paint(now: number): void {
      if (alive !== true || canvas === null || ctx === null) {
        return;
      }
      frame = window.requestAnimationFrame(paint);
      if (now - lastPaint < 66) {
        return;
      }
      lastPaint = now;
      analyser.getByteTimeDomainData(bins);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
      ctx.fillRect(0, 0, width, height);
      let energy = 0;
      for (let i = 0; i < bins.length; i += 1) {
        const sample = bins[i];
        if (sample === undefined) {
          continue;
        }
        const centered = (sample - 128) / 128;
        energy += centered * centered;
      }
      energy = Math.sqrt(energy / bins.length);
      const hot = energy > 0.04;
      ctx.lineWidth = hot ? 2.4 : 1.6;
      ctx.strokeStyle = hot ? "rgb(52, 211, 153)" : "rgb(148, 163, 184)";
      ctx.beginPath();
      const step = width / bins.length;
      let x = 0;
      for (let i = 0; i < bins.length; i += 1) {
        const sample = bins[i];
        if (sample === undefined) {
          continue;
        }
        const v = sample / 128;
        const y = (v * height) / 2;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += step;
      }
      ctx.stroke();
      const barCount = 24;
      const barGap = 3;
      const barWidth = (width - barGap * (barCount - 1)) / barCount;
      const chunk = Math.floor(bins.length / barCount);
      for (let b = 0; b < barCount; b += 1) {
        let peak = 0;
        const start = b * chunk;
        for (let i = start; i < start + chunk && i < bins.length; i += 1) {
          const sample = bins[i];
          if (sample === undefined) {
            continue;
          }
          const amp = Math.abs(sample - 128) / 128;
          if (amp > peak) {
            peak = amp;
          }
        }
        const barHeight = Math.max(3, peak * height * 0.85);
        const bx = b * (barWidth + barGap);
        const by = (height - barHeight) / 2;
        ctx.fillStyle = hot
          ? `rgba(52, 211, 153, ${String(0.25 + peak * 0.55)})`
          : `rgba(100, 116, 139, ${String(0.2 + peak * 0.35)})`;
        ctx.fillRect(bx, by, barWidth, barHeight);
      }
    }

    void audioCtx.resume();
    frame = window.requestAnimationFrame(paint);
    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      source.disconnect();
      void audioCtx.close();
    };
  }, [props.stream, props.active]);

  return (
    <canvas
      ref={canvasRef}
      width={720}
      height={88}
      className={cn("h-[88px] w-full rounded-md", props.className)}
      aria-hidden="true"
    />
  );
}
