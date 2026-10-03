// One student action includes authentication, generation, parsing and validation.
// Inner deadlines leave time for the outer layer to return an actionable error.
export const GUIDANCE_REQUEST_TIMEOUT_MS = 30_000;
export const GUIDANCE_WORKER_TIMEOUT_MS = 28_000;
export const GUIDANCE_MODEL_TIMEOUT_MS = 25_000;
