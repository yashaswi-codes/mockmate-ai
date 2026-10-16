// groqClient.js
// Thin wrapper around the Groq chat completions endpoint.
// Handles retries for rate limits (429) and transient server errors (5xx).
// Nothing in this file is specific to interview questions — it's a generic
// "call Groq, get text back, retry sensibly" helper used by every route.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const MAX_RETRIES = 2; // total attempts = 1 initial + 2 retries
const BASE_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls Groq's chat completion endpoint.
 * @param {Object} opts
 * @param {Array}  opts.messages - chat messages array (system/user)
 * @param {number} [opts.maxTokens] - cap on response size, keeps token usage low
 * @param {boolean} [opts.jsonMode] - if true, asks Groq to return raw JSON
 * @returns {Promise<string>} the raw text content of the model's reply
 * @throws {Error} with a `.status` property set for known failure types:
 *   - status 429: rate limited even after retries
 *   - status 503: Groq unreachable / repeated server errors
 *   - status 500: missing API key or unexpected failure
 */
async function callGroq({ messages, maxTokens = 800, jsonMode = false, temperature = 0.5 }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "GROQ_API_KEY is not set. Copy .env.example to .env and add your key."
    );
    err.status = 500;
    throw err;
  }

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      // Network-level failure (DNS, connection refused, etc.)
      lastError = networkErr;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      const err = new Error("Could not reach Groq. Check your internet connection.");
      err.status = 503;
      throw err;
    }

    if (response.ok) {
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        const err = new Error("Groq returned an empty response.");
        err.status = 502;
        throw err;
      }
      return content;
    }

    // Rate limited — respect Retry-After if present, otherwise backoff
    if (response.status === 429) {
      if (attempt < MAX_RETRIES) {
        const retryAfterHeader = response.headers.get("retry-after");
        const waitMs = retryAfterHeader
          ? parseFloat(retryAfterHeader) * 1000
          : BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(waitMs);
        continue;
      }
      const err = new Error(
        "Groq's request limit has been reached for now. Please wait a bit and try again."
      );
      err.status = 429;
      throw err;
    }

    // Transient server-side error — retry
    if (response.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      const err = new Error("Groq is temporarily unavailable. Please try again shortly.");
      err.status = 503;
      throw err;
    }

    // Other errors (400, 401, etc.) — not retryable
    const errorText = await response.text().catch(() => "");
    const err = new Error(
      `Groq request failed (${response.status}). ${errorText.slice(0, 200)}`
    );
    err.status = response.status;
    throw err;
  }

  // Should not reach here, but guard just in case
  const err = new Error(lastError?.message || "Unknown error calling Groq.");
  err.status = 503;
  throw err;
}

module.exports = { callGroq };