export function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = input[index];
    if (sample === undefined) {
      output[index] = 0;
      continue;
    }
    let clipped = sample;
    if (clipped > 1) {
      clipped = 1;
    }
    if (clipped < -1) {
      clipped = -1;
    }
    if (clipped < 0) {
      output[index] = clipped * 0x8000;
    } else {
      output[index] = clipped * 0x7fff;
    }
  }
  return output;
}

export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) {
    return input;
  }
  const ratio = inputRate / 16000;
  const newLength = Math.floor(input.length / ratio);
  const result = new Float32Array(newLength);
  for (let index = 0; index < newLength; index += 1) {
    const start = Math.floor(index * ratio);
    const sample = input[start];
    if (sample === undefined) {
      result[index] = 0;
      continue;
    }
    result[index] = sample;
  }
  return result;
}
