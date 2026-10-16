// storage.js — Module 8: session persistence via localStorage.
// Privacy note: only the role, the generated questions, and the user's own
// answers/metrics/feedback are ever stored here. The resume's raw text is
// never written to localStorage — it only ever lived in memory for the
// single request that generated the questions, and it stays that way.

(function () {
  const STORAGE_KEY = "mockmate_session_v1";

  function saveSession({ role, questions, currentIndex }) {
    try {
      const payload = { role, questions, currentIndex, savedAt: Date.now() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can fail (private browsing, quota, disabled) — the app
      // still works fine without persistence, so we just skip silently.
    }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to do */
    }
  }

  // --- Completed-interview history (this browser only, no login) ---
  const HISTORY_KEY = "mockmate_history_v1";
  const MAX_HISTORY = 20; // keeps localStorage usage small and bounded

  function addToHistory({ role, questions }) {
    try {
      const existing = getHistory();
      const entry = { role, questions, completedAt: Date.now() };
      const updated = [entry, ...existing].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch {
      /* history is a nice-to-have — never block the app over it */
    }
  }

  function getHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function clearHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* nothing to do */
    }
  }

  window.MockMateStorage = {
    saveSession,
    loadSession,
    clearSession,
    addToHistory,
    getHistory,
    clearHistory,
  };
})();