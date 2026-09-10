// The completion chime as a small WAV file built in memory: two soft sine
// notes, 660 Hz and then 880 Hz 0.16 s later, each rising for 20 ms and
// fading out over half a second. The page plays it through an ordinary
// audio element, so there is no audio-graph code and the pack ships no
// sound file. Pure - no DOM, no ComfyUI - and tested in tests/chime.test.mjs.

export const CHIME_RATE = 22050;
export const CHIME_SECONDS = 0.72;

const NOTES = [[0, 660], [0.16, 880]]; // [start in seconds, frequency in Hz]
const PEAK = 0.08;
const FLOOR = 0.0001;
const RISE = 0.02;
const FADE_END = 0.5;

// Exponential rise from near silence to the peak, then an exponential fall
// back to near silence by FADE_END: the curve the chime has always had.
function envelope(time) {
  if (time < 0 || time >= FADE_END) return 0;
  if (time < RISE) return FLOOR * (PEAK / FLOOR) ** (time / RISE);
  return PEAK * (FLOOR / PEAK) ** ((time - RISE) / (FADE_END - RISE));
}

export function chimeSamples(rate = CHIME_RATE) {
  const samples = new Float32Array(Math.round(CHIME_SECONDS * rate));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / rate;
    let value = 0;
    for (const [start, frequency] of NOTES) {
      const local = time - start;
      value += envelope(local) * Math.sin(2 * Math.PI * frequency * local);
    }
    samples[index] = value;
  }
  return samples;
}

// Mono 16-bit PCM WAV bytes for the samples.
export function wavBytes(samples, rate = CHIME_RATE) {
  const dataBytes = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(view.buffer);
}
