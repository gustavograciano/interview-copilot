// Continuous PCM capture via Web Audio. The recorder NEVER stops mid-session —
// we keep accumulating samples and slice them on each flush. This guarantees
// zero audio loss between chunks (the previous MediaRecorder-based version
// could drop ~100-200ms when restarting after a flush).

const TARGET_SAMPLE_RATE = 16000;
// Default (interview) timing. 1.2s of silence ≈ a real sentence boundary;
// 20s max keeps a non-stop speaker from pinning us forever.
const SILENCE_MS = 1200;
const MIN_SPEECH_MS = 500;
const MAX_CHUNK_MS = 20000;
const FRAME_MS = 50;
const VAD_THRESHOLD = 0.012;

export type AudioStatus = 'idle' | 'listening' | 'speech' | 'flushing';

export interface AudioTiming {
  silenceMs?: number; // pause length that ends a segment
  maxChunkMs?: number; // force a flush mid-speech so text appears sooner
  minSpeechMs?: number;
}

export interface AudioCaptureCallbacks {
  onChunk: (blob: Blob, mime: string, durationMs: number) => void;
  onStatus?: (status: AudioStatus) => void;
  onError?: (err: Error) => void;
  onLevel?: (rms: number) => void;
}

export class AudioCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private srcNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;

  // Sample buffers: each entry is a Float32Array slice for the CURRENT segment.
  // On flush, we encode all of them as one WAV blob, then start a fresh segment.
  private segmentChunks: Float32Array[] = [];
  private segmentSamples = 0;

  // VAD state (still runs at frame granularity off the analyser).
  private rafTimer: number | null = null;
  private speakingMs = 0;
  private silenceMs = 0;
  private isSpeechActive = false;

  private cbs: AudioCaptureCallbacks | null = null;

  // Active timing (overridable per session — transcript mode flushes faster).
  private silenceMs_ = SILENCE_MS;
  private maxChunkMs_ = MAX_CHUNK_MS;
  private minSpeechMs_ = MIN_SPEECH_MS;

  async start(deviceId: string, cbs: AudioCaptureCallbacks, timing?: AudioTiming) {
    this.cbs = cbs;
    this.silenceMs_ = timing?.silenceMs ?? SILENCE_MS;
    this.maxChunkMs_ = timing?.maxChunkMs ?? MAX_CHUNK_MS;
    this.minSpeechMs_ = timing?.minSpeechMs ?? MIN_SPEECH_MS;
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? {
              deviceId: { exact: deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Force AudioContext to 16kHz so we don't have to resample manually.
      // (Browser does the resampling internally between the device rate and ctx rate.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE });

      this.srcNode = this.ctx.createMediaStreamSource(this.stream);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.srcNode.connect(this.analyser);

      // ScriptProcessorNode is deprecated but reliable in Electron's Chromium and
      // far simpler than AudioWorklet for this use case. 4096 samples @ 16kHz
      // emits a callback ~every 256ms.
      const bufSize = 4096;
      this.workletNode = this.ctx.createScriptProcessor(bufSize, 1, 1);
      this.srcNode.connect(this.workletNode);
      // Connect to a muted destination so the node actually pulls data.
      const muted = this.ctx.createGain();
      muted.gain.value = 0;
      this.workletNode.connect(muted);
      muted.connect(this.ctx.destination);

      this.workletNode.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        // Copy because the underlying buffer is reused.
        const slice = new Float32Array(input.length);
        slice.set(input);
        this.segmentChunks.push(slice);
        this.segmentSamples += slice.length;
      };

      cbs.onStatus?.('listening');
      this.startVadLoop(cbs);
    } catch (err) {
      cbs.onError?.(err as Error);
    }
  }

  stop() {
    if (this.rafTimer != null) {
      window.clearInterval(this.rafTimer);
      this.rafTimer = null;
    }
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
        this.workletNode.onaudioprocess = null;
      } catch {
        /* ignore */
      }
    }
    if (this.srcNode) {
      try {
        this.srcNode.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.workletNode = null;
    this.srcNode = null;
    this.analyser = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.segmentChunks = [];
    this.segmentSamples = 0;
    this.speakingMs = 0;
    this.silenceMs = 0;
    this.isSpeechActive = false;
    this.cbs = null;
  }

  private startVadLoop(cbs: AudioCaptureCallbacks) {
    const buf = new Float32Array(this.analyser!.fftSize);

    this.rafTimer = window.setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      const rms = computeRMS(buf);
      cbs.onLevel?.(rms);
      const isSpeech = rms > VAD_THRESHOLD;

      if (isSpeech) {
        this.speakingMs += FRAME_MS;
        this.silenceMs = 0;
        if (!this.isSpeechActive) {
          this.isSpeechActive = true;
          cbs.onStatus?.('speech');
        }
        if (this.speakingMs >= this.maxChunkMs_) {
          this.flush(cbs);
        }
      } else {
        if (this.isSpeechActive) {
          this.silenceMs += FRAME_MS;
          if (this.silenceMs >= this.silenceMs_ && this.speakingMs >= this.minSpeechMs_) {
            this.flush(cbs);
          }
        }
      }
    }, FRAME_MS);
  }

  private flush(cbs: AudioCaptureCallbacks) {
    if (this.segmentSamples === 0) {
      this.resetSegmentState();
      return;
    }
    cbs.onStatus?.('flushing');

    // Concatenate all Float32Array chunks into one PCM stream.
    const pcm = new Float32Array(this.segmentSamples);
    let offset = 0;
    for (const chunk of this.segmentChunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    const durationMs = (this.segmentSamples / TARGET_SAMPLE_RATE) * 1000;

    // Reset segment IMMEDIATELY so new audio coming in goes into the next segment
    // — there's no stop/restart of the capture, so zero gap.
    this.segmentChunks = [];
    this.segmentSamples = 0;
    this.speakingMs = 0;
    this.silenceMs = 0;
    this.isSpeechActive = false;

    const wav = encodeWAV(pcm, TARGET_SAMPLE_RATE);
    cbs.onChunk(new Blob([wav], { type: 'audio/wav' }), 'audio/wav', durationMs);
    cbs.onStatus?.('listening');
  }

  private resetSegmentState() {
    this.segmentChunks = [];
    this.segmentSamples = 0;
    this.speakingMs = 0;
    this.silenceMs = 0;
    this.isSpeechActive = false;
  }
}

function computeRMS(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// Encodes Float32 PCM (-1..1) as a 16-bit PCM WAV file.
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}
