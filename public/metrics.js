// metrics.js — Module 5: local communication analysis.
// Everything here runs instantly in the browser, no API calls, no cost.
// Exposed as window.MockMateMetrics so app.js can call it without any
// bundler/import setup — this is a plain script tag, loaded before app.js.

(function () {
  // Common English fillers, plus a couple of Hindi-English ones people
  // actually say mid-sentence. Multi-word entries ("you know") are matched
  // as a phrase, not as separate words.
  const FILLER_WORDS = [
    "um", "umm", "uh", "uhh", "uhm",
    "like", "you know", "basically", "actually", "literally",
    "matlab", "so yeah",
  ];

  // Builds one regex that matches any filler as a whole word/phrase,
  // case-insensitive. Longer phrases are listed first so "you know" matches
  // before any accidental partial overlap.
  const fillerPattern = new RegExp(
    "\\b(" +
      FILLER_WORDS.slice()
        .sort((a, b) => b.length - a.length)
        .map((f) => f.replace(/\s+/g, "\\s+"))
        .join("|") +
      ")\\b",
    "gi"
  );

  function countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  }

  function countFillerWords(text) {
    if (!text) return { count: 0, breakdown: {} };
    const matches = text.match(fillerPattern) || [];
    const breakdown = {};
    for (const m of matches) {
      const key = m.toLowerCase();
      breakdown[key] = (breakdown[key] || 0) + 1;
    }
    return { count: matches.length, breakdown };
  }

  // Flags immediate word repeats ("the the", "I I was") — a common verbal
  // stumble marker. Deliberately simple: consecutive, case-insensitive,
  // exact-word matches only, not a general-purpose repetition analyzer.
  function detectRepetition(text) {
    if (!text) return 0;
    const words = text.trim().toLowerCase().split(/\s+/);
    let repeats = 0;
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1].replace(/[^\w']/g, "");
      const curr = words[i].replace(/[^\w']/g, "");
      if (prev && prev === curr) repeats++;
    }
    return repeats;
  }

  // Returns null (not 0) when we don't have a meaningful speaking duration —
  // e.g. the person typed their answer instead of using the mic. Showing
  // "0 WPM" there would be misleading, so the caller should treat null as
  // "not applicable" rather than a real measurement.
  function calculateWPM(wordCount, durationSeconds) {
    if (!durationSeconds || durationSeconds < 1) return null;
    return Math.round((wordCount / durationSeconds) * 60);
  }

  function analyzeAnswer(text, durationSeconds) {
    const wordCount = countWords(text);
    const fillers = countFillerWords(text);
    const wpm = calculateWPM(wordCount, durationSeconds);
    const repetitionCount = detectRepetition(text);

    return {
      wordCount,
      fillerCount: fillers.count,
      fillerBreakdown: fillers.breakdown,
      wpm, // null if no voice duration was recorded
      repetitionCount,
      durationSeconds: durationSeconds || 0,
    };
  }

  window.MockMateMetrics = {
    analyzeAnswer,
    countWords,
    countFillerWords,
    detectRepetition,
    calculateWPM,
  };
})();