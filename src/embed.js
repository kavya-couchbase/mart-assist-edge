// On-device embeddings: all-MiniLM-L6-v2 (384-dim) running in the browser via ONNX/WASM.
// First load downloads the model (~23 MB) and caches it; after that it works offline.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL = 'Xenova/all-MiniLM-L6-v2';
let extractorPromise;

export function loadModel(onProgress) {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: onProgress,
    });
  }
  return extractorPromise;
}

export async function embed(text) {
  const extractor = await loadModel();
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}
