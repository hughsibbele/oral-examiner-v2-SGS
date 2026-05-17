// PCM Audio Worklet — forwards mic Float32 frames to the main thread for
// PCM16 + base64 encoding + sending to Gemini Live. Loaded by TryItOut.tsx
// via `audioContext.audioWorklet.addModule('/pcm-audio-worklet.js')`.
//
// Runs in a separate AudioWorkletGlobalScope; no DOM or app imports here.

class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;
    // Copy to a transferable so the worklet thread doesn't keep a reference
    // (the underlying buffer is reused).
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    this.port.postMessage(copy, [copy.buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
