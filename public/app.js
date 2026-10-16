// app.js — Module 1: setup screen wiring + question generation test.
// Later modules will add voice I/O, the interview flow, and the report screen
// in this same file, without touching what's already working here.

const CATEGORY_LABELS = {
  personal: "Personal",
  resume: "Resume-based",
  fundamentals: "Fundamentals",
  problem_solving: "Problem-Solving",
};

const roleInput = document.getElementById("role-input");
const resumeInput = document.getElementById("resume-input");
const charCount = document.getElementById("char-count");
const generateBtn = document.getElementById("generate-btn");
const setupError = document.getElementById("setup-error");

const setupScreen = document.getElementById("setup-screen");
const loadingScreen = document.getElementById("loading-screen");
const interviewScreen = document.getElementById("interview-screen");
const completionScreen = document.getElementById("completion-screen");
const historyScreen = document.getElementById("history-screen");
const typingDots = document.getElementById("typing-dots");
const successCheck = document.getElementById("success-check");

const categoryLabel = document.getElementById("category-label");
const progressLabel = document.getElementById("progress-label");
const progressFill = document.getElementById("progress-fill");
const questionTextEl = document.getElementById("question-text");
const answerInput = document.getElementById("answer-input");
const interviewError = document.getElementById("interview-error");
const feedbackCard = document.getElementById("feedback-card");
const feedbackScore = document.getElementById("feedback-score");
const feedbackSkippedNote = document.getElementById("feedback-skipped-note");
const feedbackDetails = document.getElementById("feedback-details");
const feedbackStrengths = document.getElementById("feedback-strengths");
const feedbackWeaknesses = document.getElementById("feedback-weaknesses");
const feedbackImprovement = document.getElementById("feedback-improvement");
const feedbackIdealList = document.getElementById("feedback-ideal-list");
const feedbackMetricsRow = document.getElementById("feedback-metrics-row");
const evaluatingIndicator = document.getElementById("evaluating-indicator");
const evalErrorActions = document.getElementById("eval-error-actions");
const retryEvalBtn = document.getElementById("retry-eval-btn");
const skipEvalBtn = document.getElementById("skip-eval-btn");
const interviewNavRow = document.getElementById("interview-nav-row");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const replayBtn = document.getElementById("replay-btn");
const micBtn = document.getElementById("mic-btn");
const recordingIndicator = document.getElementById("recording-indicator");
const voiceUnsupportedNote = document.getElementById("voice-unsupported-note");
const endEarlyBtn = document.getElementById("end-early-btn");
const exitInterviewBtn = document.getElementById("exit-interview-btn");
const restartBtn = document.getElementById("restart-btn");
const viewHistoryBtn = document.getElementById("view-history-btn");
const historyBackBtn = document.getElementById("history-back-btn");
const historyList = document.getElementById("history-list");
const historyEmptyNote = document.getElementById("history-empty-note");
const categoryDetailScreen = document.getElementById("category-detail-screen");
const detailEyebrow = document.getElementById("detail-eyebrow");
const detailHeading = document.getElementById("detail-heading");
const detailSub = document.getElementById("detail-sub");
const detailList = document.getElementById("detail-list");
const detailBackBtn = document.getElementById("detail-back-btn");
const backToHistoryBtn = document.getElementById("back-to-history-btn");
const completionHeading = document.getElementById("completion-heading");
const completionSub = document.getElementById("completion-sub");
const reportOverallScore = document.getElementById("report-overall-score");
const reportScoreNote = document.getElementById("report-score-note");
const reportCategories = document.getElementById("report-categories");
const reportMetricsRow = document.getElementById("report-metrics-row");
const reportFillersNote = document.getElementById("report-fillers-note");

const CATEGORY_ORDER = ["personal", "resume", "fundamentals", "problem_solving"];

// --- Voice output (Module 3): the question is read aloud automatically,
// and the replay button lets the user hear it again. If the browser doesn't
// support speech synthesis, we just hide the controls — typing still works
// fine either way, nothing else in the flow depends on this.

const speechSupported = "speechSynthesis" in window;

if (!speechSupported) {
  replayBtn.hidden = true;
}

function speakQuestion(text) {
  if (!speechSupported) return;
  window.speechSynthesis.cancel(); // stop whatever was being read before
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if (speechSupported) window.speechSynthesis.cancel();
}

replayBtn.addEventListener("click", () => {
  const q = interviewQuestions[currentIndex];
  if (q) speakQuestion(q.text);
});

// --- Voice input (Module 4): mic button transcribes speech into the answer
// box live. SpeechRecognition is reliably supported in Chrome/Edge-type
// browsers only — on anything else we hide the mic and fall back to typing,
// which already works fine on its own.

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognitionSupported = !!SpeechRecognitionAPI;

if (!recognitionSupported) {
  micBtn.hidden = true;
  voiceUnsupportedNote.hidden = false;
}

let recognition = null; // the CURRENT active recognition instance, or null
let isRecording = false;
let userRequestedStop = false; // distinguishes a deliberate stop from Chrome's own silent auto-stop
let recordingStartedAt = null;
let recordingQuestionIndex = null; // which question this recording session belongs to
let baseTextBeforeRecording = "";
let finalTranscriptSoFar = "";

function createRecognition() {
  const instance = new SpeechRecognitionAPI();
  instance.continuous = true;
  instance.interimResults = true;
  instance.lang = "en-US";
  const forQuestionIndex = recordingQuestionIndex;

  // Two guards here, both needed: `recognition !== instance` catches a stale
  // instance after a *new* recording has started; `currentIndex !== forQuestionIndex`
  // catches a late event arriving after we've navigated away with nothing new
  // recording yet. Either one being stale means: don't touch the page.
  instance.onresult = (event) => {
    if (recognition !== instance || currentIndex !== forQuestionIndex) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscriptSoFar += transcript + " ";
      } else {
        interim += transcript;
      }
    }
    const combined = [baseTextBeforeRecording, finalTranscriptSoFar + interim]
      .filter(Boolean)
      .join(" ");
    answerInput.value = combined;
  };

  instance.onerror = (event) => {
    if (recognition !== instance || currentIndex !== forQuestionIndex) return;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showInterviewError("Microphone access was blocked. Please allow it, or just type your answer.");
      stopRecording();
    } else if (event.error === "audio-capture") {
      showInterviewError("No microphone was found. Please type your answer instead.");
      stopRecording();
    }
    // Other errors (e.g. "no-speech", transient network hiccups) are left to
    // onend below, which restarts listening automatically instead of giving up.
  };

  instance.onend = () => {
    if (recognition !== instance) return; // a newer instance has already taken over
    if (userRequestedStop || !isRecording || currentIndex !== forQuestionIndex) {
      finishStop();
      return;
    }
    // Chrome ends "continuous" recognition on its own after a pause or
    // internal timeout, even though the user never clicked stop. Restart
    // seamlessly, carrying forward whatever's already in the answer box,
    // so a long answer doesn't silently stop being captured.
    baseTextBeforeRecording = answerInput.value.trim();
    finalTranscriptSoFar = "";
    const restarted = createRecognition();
    recognition = restarted;
    try {
      restarted.start();
    } catch {
      finishStop();
    }
  };

  return instance;
}

function startRecording() {
  if (!recognitionSupported || isRecording) return;

  userRequestedStop = false;
  baseTextBeforeRecording = answerInput.value.trim();
  finalTranscriptSoFar = "";
  recordingStartedAt = Date.now();
  recordingQuestionIndex = currentIndex;

  recognition = createRecognition();

  try {
    recognition.start();
    isRecording = true;
    micBtn.classList.add("recording");
    recordingIndicator.hidden = false;
  } catch {
    // start() can throw if called in a bad state — fail quietly, typing still works.
    isRecording = false;
    recognition = null;
  }
}

function stopRecording() {
  userRequestedStop = true;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      /* already stopped */
    }
  }
  // onend will call finishStop() once the browser confirms it's actually
  // stopped; call it here too in case there was nothing active to stop.
  if (!recognition) finishStop();
}

function finishStop() {
  if (isRecording && recordingStartedAt && recordingQuestionIndex !== null) {
    const durationSeconds = (Date.now() - recordingStartedAt) / 1000;
    const q = interviewQuestions[recordingQuestionIndex];
    if (q) {
      q.answerDurationSeconds = (q.answerDurationSeconds || 0) + durationSeconds;
    }
  }
  isRecording = false;
  recordingStartedAt = null;
  recordingQuestionIndex = null;
  recognition = null;
  micBtn.classList.remove("recording");
  recordingIndicator.hidden = true;
}

micBtn.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// Interview state. `interviewQuestions` is the 30 questions from the backend,
// each annotated with whether it's been answered yet and what was typed.
// `currentIndex` is which one is currently on screen.
let interviewQuestions = [];
let currentIndex = 0;
let currentSessionId = null; // stable id so one interview is only ever one history entry
let currentRole = ""; // captured when generation succeeds, used by answer evaluation requests

resumeInput.addEventListener("input", () => {
  charCount.textContent = resumeInput.value.length;
});

// --- PDF upload (optional alternative to pasting text) ---
// Runs entirely in the browser via pdf.js. The extracted text lands in the
// same textarea the user could type into — nothing about the backend changes,
// and the user can still edit the result before generating questions.

const resumePdfInput = document.getElementById("resume-pdf-input");
const uploadStatus = document.getElementById("upload-status");
const dropzone = document.getElementById("dropzone");

const PDF_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB, generous for a text resume

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

async function handleResumeFile(file) {
  if (!file) return;

  uploadStatus.className = "upload-status";
  uploadStatus.textContent = "";

  if (file.type !== "application/pdf") {
    uploadStatus.className = "upload-status error";
    uploadStatus.textContent = "Please choose a PDF file.";
    return;
  }
  if (file.size > PDF_MAX_SIZE_BYTES) {
    uploadStatus.className = "upload-status error";
    uploadStatus.textContent = "That PDF is too large (max 10MB).";
    return;
  }
  if (!window.pdfjsLib) {
    uploadStatus.className = "upload-status error";
    uploadStatus.textContent = "PDF reader didn't load. Please paste your resume text instead.";
    return;
  }

  uploadStatus.className = "upload-status";
  uploadStatus.textContent = "Extracting text…";

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      fullText += pageText + "\n";
    }
    fullText = fullText.trim();

    if (fullText.length < 30) {
      uploadStatus.className = "upload-status error";
      uploadStatus.textContent =
        "Couldn't find readable text in this PDF (it may be a scanned image). Please paste your resume text instead.";
      return;
    }

    if (fullText.length > 6000) {
      fullText = fullText.slice(0, 6000);
    }

    resumeInput.value = fullText;
    charCount.textContent = resumeInput.value.length;
    uploadStatus.className = "upload-status success";
    uploadStatus.textContent = `✓ Extracted from ${file.name} — feel free to edit below.`;
  } catch (err) {
    uploadStatus.className = "upload-status error";
    uploadStatus.textContent = "Couldn't read that PDF. Please paste your resume text instead.";
  }
}

resumePdfInput.addEventListener("change", () => {
  const file = resumePdfInput.files[0];
  handleResumeFile(file).finally(() => {
    resumePdfInput.value = ""; // allow re-uploading the same file later if needed
  });
});

// Drag-and-drop onto the dropzone — same handling path as the file picker.
["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleResumeFile(file);
});

function showScreen(screen) {
  const current = [setupScreen, loadingScreen, interviewScreen, completionScreen, historyScreen, categoryDetailScreen].find(
    (s) => !s.hidden
  );
  if (current === screen) return;

  if (current) {
    current.classList.add("screen-leave");
    setTimeout(() => {
      current.hidden = true;
      current.classList.remove("screen-leave");
    }, 150);
  }

  setTimeout(() => {
    screen.hidden = false;
    screen.classList.add("screen-enter");
    requestAnimationFrame(() => {
      screen.classList.add("screen-enter-active");
    });
    setTimeout(() => {
      screen.classList.remove("screen-enter", "screen-enter-active");
    }, 300);
  }, current ? 150 : 0);
}

function showSetupError(message) {
  setupError.textContent = message;
  setupError.hidden = false;
}

function clearSetupError() {
  setupError.hidden = true;
  setupError.textContent = "";
}

generateBtn.addEventListener("click", async () => {
  clearSetupError();

  const role = roleInput.value.trim();
  const resume = resumeInput.value.trim();

  if (!role) {
    showSetupError("Please enter a job role.");
    return;
  }
  if (resume.length < 30) {
    showSetupError("Please paste a bit more of your resume (at least 30 characters).");
    return;
  }

  generateBtn.disabled = true;
  generateBtn.classList.add("btn-loading");
  typingDots.hidden = false;
  successCheck.hidden = true;
  showScreen(loadingScreen);

  try {
    const response = await fetch("/api/generate-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, resume }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Friendly, specific message for the most common failure: rate limiting.
      const message =
        response.status === 429
          ? "We're being rate-limited right now. Please wait a moment and try again."
          : data.error || "Something went wrong. Please try again.";
      generateBtn.disabled = false;
      generateBtn.classList.remove("btn-loading");
      showScreen(setupScreen);
      showSetupError(message);
      return;
    }

    // Brief success checkmark before moving on, so the transition doesn't feel abrupt.
    typingDots.hidden = true;
    successCheck.hidden = false;
    await new Promise((resolve) => setTimeout(resolve, 550));

    currentRole = role;
    startInterview(data.questions);
    showScreen(interviewScreen);
  } catch (networkErr) {
    generateBtn.disabled = false;
    generateBtn.classList.remove("btn-loading");
    showScreen(setupScreen);
    showSetupError("Couldn't reach the server. Is it running?");
  }
});

// --- Interview flow: one question at a time, with locked history ---
// Previous only ever lets you *look back* at a question you already answered —
// it never re-opens that answer for editing or re-submission. Only the current,
// unanswered question is ever editable.

function startInterview(questions) {
  interviewQuestions = questions.map((q) => ({ ...q, answered: false, answerText: "" }));
  currentSessionId = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  currentIndex = 0;
  renderInterviewQuestion();
}

function renderInterviewQuestion(speak = true) {
  const total = interviewQuestions.length;
  const q = interviewQuestions[currentIndex];
  const isLast = currentIndex === total - 1;

  interviewError.hidden = true;
  interviewError.textContent = "";

  categoryLabel.textContent = CATEGORY_LABELS[q.category] || q.category;
  progressLabel.textContent = `Question ${currentIndex + 1} of ${total}`;
  progressFill.style.width = `${((currentIndex + 1) / total) * 100}%`;
  questionTextEl.textContent = q.text;
  if (speak) speakQuestion(q.text);

  stopRecording();

  answerInput.value = q.answerText;
  answerInput.disabled = q.answered;
  if (recognitionSupported) micBtn.disabled = q.answered;

  prevBtn.disabled = currentIndex === 0;

  if (q.answered) {
    nextBtn.textContent = isLast ? "Finish" : "Next →";
  } else {
    nextBtn.textContent = isLast ? "Finish" : "Submit & Next →";
  }

  renderFeedbackCard(q);

  // Always start a freshly-rendered question in the normal (non-evaluating,
  // non-error) state — these only reappear if a new submission hits them.
  evaluatingIndicator.hidden = true;
  evalErrorActions.hidden = true;
  interviewNavRow.hidden = false;

  window.MockMateStorage.saveSession({
    role: currentRole,
    questions: interviewQuestions,
    currentIndex,
    sessionId: currentSessionId,
  });
}

// Saves an interview into history (this browser only). Called as soon as the
// last answer is locked, and also when a session is exited/discarded part-way
// (as long as at least one question was answered), so no past session is lost.
function archiveSession(role, questions, sessionId) {
  if (!Array.isArray(questions)) return;
  const answeredCount = questions.filter((q) => q.answered).length;
  if (answeredCount === 0) return;
  window.MockMateStorage.addToHistory({
    id: sessionId,
    role,
    questions,
    partial: answeredCount < questions.length,
  });
}

function showInterviewError(message) {
  interviewError.textContent = message;
  interviewError.hidden = false;
}

// --- Module 9: final report, built entirely from data already collected
// during the interview (Module 5's metrics + Module 6's AI feedback).
// No new API call happens here.

function average(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function buildReport(questions) {
  const byCategory = {};
  const allScores = [];
  let totalWords = 0;
  let totalFillers = 0;
  let totalRepetitions = 0;
  const wpmValues = [];
  const fillerBreakdown = {};

  for (const q of questions) {
    if (!byCategory[q.category]) byCategory[q.category] = { scores: [], count: 0 };
    byCategory[q.category].count++;

    if (q.feedback && typeof q.feedback.score === "number") {
      byCategory[q.category].scores.push(q.feedback.score);
      allScores.push(q.feedback.score);
    }

    if (q.metrics) {
      totalWords += q.metrics.wordCount || 0;
      totalFillers += q.metrics.fillerCount || 0;
      totalRepetitions += q.metrics.repetitionCount || 0;
      if (q.metrics.wpm !== null && q.metrics.wpm !== undefined) {
        wpmValues.push(q.metrics.wpm);
      }
      for (const [word, count] of Object.entries(q.metrics.fillerBreakdown || {})) {
        fillerBreakdown[word] = (fillerBreakdown[word] || 0) + count;
      }
    }
  }

  const categories = CATEGORY_ORDER.map((key) => {
    const data = byCategory[key] || { scores: [], count: 0 };
    return {
      key,
      label: CATEGORY_LABELS[key] || key,
      count: data.count,
      scoredCount: data.scores.length,
      avgScore: average(data.scores),
    };
  });

  const avgWpm = average(wpmValues);

  return {
    overallScore: average(allScores),
    scoredCount: allScores.length,
    skippedCount: questions.length - allScores.length,
    categories,
    totalWords,
    avgWpm: avgWpm !== null ? Math.round(avgWpm) : null,
    totalFillers,
    fillerBreakdown,
    totalRepetitions,
  };
}

function topFillers(breakdown, n = 3) {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => `"${word}" ×${count}`);
}

let currentReportQuestions = []; // whichever session the report is currently showing

// --- Category detail: every question in a category, with the user's answers ---
function appendLine(parent, tagText, tagClass, text) {
  const p = document.createElement("p");
  p.className = "feedback-line";
  const tag = document.createElement("span");
  tag.className = "feedback-tag " + tagClass;
  tag.textContent = tagText;
  const body = document.createElement("span");
  body.textContent = text;
  p.appendChild(tag);
  p.appendChild(body);
  parent.appendChild(p);
}

function buildQACard(q, number) {
  const card = document.createElement("div");
  card.className = "detail-card";

  const qLabel = document.createElement("p");
  qLabel.className = "detail-q-number";
  qLabel.textContent = `Question ${number}`;
  const qText = document.createElement("p");
  qText.className = "detail-q-text";
  qText.textContent = q.text;
  card.appendChild(qLabel);
  card.appendChild(qText);

  const ansLabel = document.createElement("p");
  ansLabel.className = "detail-answer-label";
  ansLabel.textContent = "Your answer";
  const ans = document.createElement("p");
  ans.className = "detail-answer";
  if (q.answered && q.answerText) {
    ans.textContent = q.answerText;
  } else {
    ans.textContent = "Not answered.";
    ans.classList.add("detail-unanswered");
  }
  card.appendChild(ansLabel);
  card.appendChild(ans);

  if (!q.answered) return card;

  const f = q.feedback;
  const head = document.createElement("div");
  head.className = "feedback-header";
  const score = document.createElement("div");
  score.className = "feedback-score";
  const lab = document.createElement("div");
  const labP = document.createElement("p");
  labP.className = "feedback-score-label";
  labP.textContent = "AI score";
  lab.appendChild(labP);
  if (f) {
    score.textContent = f.score;
    score.classList.add(scoreClass(f.score));
  } else {
    score.textContent = "–";
    const note = document.createElement("p");
    note.className = "feedback-skipped-note";
    note.textContent = "AI feedback was skipped for this answer.";
    lab.appendChild(note);
  }
  head.appendChild(score);
  head.appendChild(lab);
  card.appendChild(head);

  if (f) {
    appendLine(card, "Strengths", "good", f.strengths);
    appendLine(card, "Could improve", "weak", f.weaknesses);
    appendLine(card, "Tip", "tip", f.improvement);
    if (Array.isArray(f.idealAnswerPoints) && f.idealAnswerPoints.length) {
      const idealLabel = document.createElement("p");
      idealLabel.className = "feedback-ideal-label";
      idealLabel.textContent = "A strong answer would cover:";
      const ul = document.createElement("ul");
      ul.className = "feedback-ideal-list";
      for (const point of f.idealAnswerPoints) {
        const li = document.createElement("li");
        li.textContent = point;
        ul.appendChild(li);
      }
      card.appendChild(idealLabel);
      card.appendChild(ul);
    }
  }

  if (q.metrics) {
    const m = q.metrics;
    const row = document.createElement("div");
    row.className = "feedback-metrics-row";
    const chips = [
      `${m.wordCount} words`,
      m.wpm !== null && m.wpm !== undefined ? `${m.wpm} WPM` : "WPM n/a (typed)",
      `${m.fillerCount} filler word${m.fillerCount === 1 ? "" : "s"}`,
    ];
    if (m.repetitionCount) {
      chips.push(`${m.repetitionCount} repeated word${m.repetitionCount === 1 ? "" : "s"}`);
    }
    for (const text of chips) {
      const span = document.createElement("span");
      span.className = "chip";
      span.textContent = text;
      row.appendChild(span);
    }
    card.appendChild(row);
  }
  return card;
}

function openCategoryDetail(categoryKey) {
  const label = CATEGORY_LABELS[categoryKey] || categoryKey;
  const inCategory = currentReportQuestions.filter((q) => q.category === categoryKey);
  const answered = inCategory.filter((q) => q.answered).length;

  detailEyebrow.textContent = "Category";
  detailHeading.textContent = label;
  detailSub.textContent = `${answered} of ${inCategory.length} answered.`;
  detailList.innerHTML = "";
  if (!inCategory.length) {
    const none = document.createElement("p");
    none.className = "sub";
    none.textContent = "No questions in this category.";
    detailList.appendChild(none);
  }
  inCategory.forEach((q, i) => detailList.appendChild(buildQACard(q, i + 1)));

  showScreen(categoryDetailScreen);
  window.scrollTo({ top: 0 });
}

detailBackBtn.addEventListener("click", () => {
  showScreen(completionScreen);
});

function renderReport(questions) {
  const report = buildReport(questions);

  reportOverallScore.classList.remove("score-high", "score-mid", "score-low");
  if (report.overallScore !== null) {
    reportOverallScore.textContent = report.overallScore.toFixed(1);
    reportOverallScore.classList.add(scoreClass(report.overallScore));
  } else {
    reportOverallScore.textContent = "–";
  }

  const unansweredCount = questions.filter((q) => !q.answered).length;
  const feedbackSkipped = report.skippedCount - unansweredCount;
  if (report.skippedCount > 0) {
    const parts = [];
    if (unansweredCount > 0) parts.push(`${unansweredCount} not answered`);
    if (feedbackSkipped > 0) parts.push(`${feedbackSkipped} had AI feedback skipped`);
    reportScoreNote.textContent = `Based on ${report.scoredCount} of ${questions.length} questions — ${parts.join(", ")}.`;
    reportScoreNote.hidden = false;
  } else {
    reportScoreNote.hidden = true;
  }

  currentReportQuestions = questions;
  reportCategories.innerHTML = "";
  for (const cat of report.categories) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "report-cat-row report-cat-clickable";
    row.setAttribute("aria-label", `View ${cat.label} questions and answers`);
    row.addEventListener("click", () => openCategoryDetail(cat.key));

    const top = document.createElement("div");
    top.className = "report-cat-top";
    const label = document.createElement("span");
    label.className = "report-cat-label";
    label.textContent = cat.label;
    const scoreText = document.createElement("span");
    scoreText.className = "report-cat-score";
    scoreText.textContent =
      (cat.avgScore !== null ? `${cat.avgScore.toFixed(1)}/10` : "No scored answers") + "  ›";
    top.appendChild(label);
    top.appendChild(scoreText);

    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = cat.avgScore !== null ? `${(cat.avgScore / 10) * 100}%` : "0%";
    track.appendChild(fill);

    row.appendChild(top);
    row.appendChild(track);
    reportCategories.appendChild(row);
  }

  reportMetricsRow.innerHTML = "";
  const chips = [
    `${report.totalWords} words total`,
    report.avgWpm !== null ? `${report.avgWpm} avg WPM` : "WPM n/a",
    `${report.totalFillers} filler word${report.totalFillers === 1 ? "" : "s"}`,
  ];
  if (report.totalRepetitions) {
    chips.push(`${report.totalRepetitions} repeated word${report.totalRepetitions === 1 ? "" : "s"}`);
  }
  for (const text of chips) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = text;
    reportMetricsRow.appendChild(span);
  }

  const topFillerList = topFillers(report.fillerBreakdown);
  if (topFillerList.length) {
    reportFillersNote.textContent = `Most-used filler words: ${topFillerList.join(", ")}.`;
    reportFillersNote.hidden = false;
  } else {
    reportFillersNote.hidden = true;
  }
}

function scoreClass(score) {
  if (score >= 7) return "score-high";
  if (score >= 4) return "score-mid";
  return "score-low";
}

// --- History browsing ---
// `viewingHistoryIndex` is null when the completion screen is showing a
// session that was *just* finished, or a number when it's showing a past
// entry pulled up from the history list instead.
let viewingHistoryIndex = null;

function formatHistoryDate(timestamp) {
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function renderHistoryList() {
  const history = window.MockMateStorage.getHistory();
  historyList.innerHTML = "";

  if (!history.length) {
    historyEmptyNote.hidden = false;
    return;
  }
  historyEmptyNote.hidden = true;

  history.forEach((entry, index) => {
    const report = buildReport(entry.questions);

    const item = document.createElement("div");
    item.className = "history-item";

    const info = document.createElement("div");
    info.className = "history-item-info";
    const role = document.createElement("p");
    role.className = "history-item-role";
    role.textContent = entry.role || "Untitled role";
    const date = document.createElement("p");
    date.className = "history-item-date";
    const answeredN = entry.questions.filter((q) => q.answered).length;
    date.textContent =
      formatHistoryDate(entry.completedAt) +
      (entry.partial || answeredN < entry.questions.length
        ? ` · Incomplete (${answeredN}/${entry.questions.length} answered)`
        : "");
    info.appendChild(role);
    info.appendChild(date);

    const right = document.createElement("div");
    right.className = "history-item-right";
    const scoreChip = document.createElement("span");
    scoreChip.className = "history-score-chip";
    if (report.overallScore !== null) {
      scoreChip.textContent = report.overallScore.toFixed(1);
      scoreChip.classList.add(scoreClass(report.overallScore));
    } else {
      scoreChip.textContent = "–";
    }
    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "history-view-btn";
    viewBtn.textContent = "View report";
    viewBtn.addEventListener("click", () => viewHistoryEntry(index));

    right.appendChild(scoreChip);
    right.appendChild(viewBtn);
    item.appendChild(info);
    item.appendChild(right);
    historyList.appendChild(item);
  });
}

function viewHistoryEntry(index) {
  const history = window.MockMateStorage.getHistory();
  const entry = history[index];
  if (!entry) return;

  viewingHistoryIndex = index;
  renderReport(entry.questions);
  completionHeading.textContent = `Past interview — ${entry.role || "Untitled role"}`;
  completionSub.textContent =
    formatHistoryDate(entry.completedAt) + (entry.partial ? " · Incomplete session" : "");
  backToHistoryBtn.hidden = false;
  showScreen(completionScreen);
}

viewHistoryBtn.addEventListener("click", () => {
  renderHistoryList();
  showScreen(historyScreen);
});

historyBackBtn.addEventListener("click", () => {
  showScreen(setupScreen);
});

backToHistoryBtn.addEventListener("click", () => {
  viewingHistoryIndex = null;
  renderHistoryList();
  showScreen(historyScreen);
});

function renderFeedbackCard(q) {
  if (!q.answered) {
    feedbackCard.hidden = true;
    return;
  }
  feedbackCard.hidden = false;

  // --- AI feedback half (or the "skipped" note in its place) ---
  const f = q.feedback;
  feedbackScore.classList.remove("score-high", "score-mid", "score-low");

  if (f) {
    feedbackScore.textContent = f.score;
    feedbackScore.classList.add(scoreClass(f.score));
    feedbackSkippedNote.hidden = true;
    feedbackDetails.hidden = false;
    feedbackStrengths.textContent = f.strengths;
    feedbackWeaknesses.textContent = f.weaknesses;
    feedbackImprovement.textContent = f.improvement;
    feedbackIdealList.innerHTML = "";
    for (const point of f.idealAnswerPoints || []) {
      const li = document.createElement("li");
      li.textContent = point;
      feedbackIdealList.appendChild(li);
    }
  } else {
    // f is null: the person chose "Continue without AI feedback".
    feedbackScore.textContent = "–";
    feedbackSkippedNote.hidden = false;
    feedbackDetails.hidden = true;
  }

  // --- Local metrics half (Module 5), always available ---
  feedbackMetricsRow.innerHTML = "";
  if (q.metrics) {
    const m = q.metrics;
    const chips = [
      `${m.wordCount} words`,
      m.wpm !== null ? `${m.wpm} WPM` : "WPM n/a (typed)",
      `${m.fillerCount} filler word${m.fillerCount === 1 ? "" : "s"}`,
    ];
    if (m.repetitionCount) {
      chips.push(`${m.repetitionCount} repeated word${m.repetitionCount === 1 ? "" : "s"}`);
    }
    for (const text of chips) {
      const span = document.createElement("span");
      span.className = "chip";
      span.textContent = text;
      feedbackMetricsRow.appendChild(span);
    }
  }
}

// --- Module 6: submitting a new answer for AI evaluation ---

function setEvaluatingState(isEvaluating) {
  answerInput.disabled = isEvaluating;
  if (recognitionSupported) micBtn.disabled = isEvaluating;
  interviewNavRow.hidden = isEvaluating;
  evaluatingIndicator.hidden = !isEvaluating;
  if (isEvaluating) evalErrorActions.hidden = true;
}

function showEvalFailure(message) {
  showInterviewError(message);
  interviewNavRow.hidden = true;
  evaluatingIndicator.hidden = true;
  evalErrorActions.hidden = false;
  answerInput.disabled = false;
  if (recognitionSupported) micBtn.disabled = false;
}

function lockAnswer(answer, feedback) {
  const q = interviewQuestions[currentIndex];

  q.answered = true;
  q.answerText = answer;
  q.metrics = window.MockMateMetrics.analyzeAnswer(answer, q.answerDurationSeconds || 0);
  q.feedback = feedback; // an evaluation object, or null if explicitly skipped

  stopSpeaking(); // the question's already been answered — no need to keep reading it
  setEvaluatingState(false);
  renderInterviewQuestion(false); // shows this same question, now with the feedback card visible

  // Don't wait for the "Finish" click: once every answer is locked, the
  // session is already safely in history.
  archiveSession(currentRole, interviewQuestions, currentSessionId);
}

async function submitCurrentAnswer() {
  const q = interviewQuestions[currentIndex];
  const answer = answerInput.value.trim();
  if (!answer) {
    showInterviewError("Please type or record an answer before continuing.");
    return;
  }

  interviewError.hidden = true;
  stopRecording();
  setEvaluatingState(true);

  try {
    const response = await fetch("/api/evaluate-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: currentRole,
        category: q.category,
        question: q.text,
        answer,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        response.status === 429
          ? "We're being rate-limited right now. Please wait a moment and try again."
          : data.error || "Evaluation failed."
      );
    }
    lockAnswer(answer, data.feedback);
  } catch (err) {
    showEvalFailure(err.message || "Couldn't reach the server. Check your connection and try again.");
  }
}

nextBtn.addEventListener("click", () => {
  const q = interviewQuestions[currentIndex];
  const total = interviewQuestions.length;
  const isLast = currentIndex === total - 1;

  if (!q.answered) {
    submitCurrentAnswer();
    return;
  }

  if (isLast) {
    stopSpeaking();
    stopRecording();
    archiveSession(currentRole, interviewQuestions, currentSessionId);
    window.MockMateStorage.clearSession();
    viewingHistoryIndex = null;
    completionHeading.textContent = "Interview complete.";
    completionSub.textContent = "Here's how you did, based on your answers and the feedback collected along the way.";
    backToHistoryBtn.hidden = true;
    renderReport(interviewQuestions);
    showScreen(completionScreen);
    return;
  }

  currentIndex++;
  renderInterviewQuestion();
});

retryEvalBtn.addEventListener("click", () => {
  evalErrorActions.hidden = true;
  submitCurrentAnswer();
});

skipEvalBtn.addEventListener("click", () => {
  const answer = answerInput.value.trim();
  if (!answer) {
    showInterviewError("Please type or record an answer before continuing.");
    return;
  }
  evalErrorActions.hidden = true;
  interviewError.hidden = true;
  lockAnswer(answer, null);
});

prevBtn.addEventListener("click", () => {
  if (currentIndex === 0) return;
  currentIndex--;
  renderInterviewQuestion();
});

endEarlyBtn.addEventListener("click", () => {
  const total = interviewQuestions.length;
  const answeredCount = interviewQuestions.filter((q) => q.answered).length;
  if (answeredCount === 0) {
    showInterviewError("Submit at least one answer first, then you can end the interview and see its report.");
    return;
  }
  const confirmed = window.confirm(
    `End the interview now? The report will cover only the ${answeredCount} of ${total} questions you've answered.`
  );
  if (!confirmed) return;
  stopSpeaking();
  stopRecording();
  archiveSession(currentRole, interviewQuestions, currentSessionId);
  window.MockMateStorage.clearSession();
  viewingHistoryIndex = null;
  completionHeading.textContent = "Interview ended early.";
  completionSub.textContent = `Report based on the ${answeredCount} of ${total} questions you answered.`;
  backToHistoryBtn.hidden = true;
  renderReport(interviewQuestions);
  showScreen(completionScreen);
});

exitInterviewBtn.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Exit this interview? Answers you've already submitted will stay in your history as an incomplete session."
  );
  if (!confirmed) return;
  stopSpeaking();
  stopRecording();
  archiveSession(currentRole, interviewQuestions, currentSessionId);
  window.MockMateStorage.clearSession();
  generateBtn.disabled = false;
  generateBtn.classList.remove("btn-loading");
  showScreen(setupScreen);
});

restartBtn.addEventListener("click", () => {
  stopSpeaking();
  stopRecording();
  window.MockMateStorage.clearSession();
  generateBtn.disabled = false;
  generateBtn.classList.remove("btn-loading");
  showScreen(setupScreen);
});

// --- Module 8: offer to resume an unfinished session on page load ---
(function checkForResumableSession() {
  const saved = window.MockMateStorage.loadSession();
  if (!saved) return;

  const total = saved.questions.length;
  const answeredCount = saved.questions.filter((q) => q.answered).length;

  if (answeredCount >= total) {
    // Fully finished but never cleared (e.g. tab closed right at the end).
    // Make sure it's in history before dropping the in-progress copy.
    archiveSession(saved.role, saved.questions, saved.sessionId);
    window.MockMateStorage.clearSession();
    return;
  }

  const resume = window.confirm(
    `You have an unfinished interview for "${saved.role}" (question ${(saved.currentIndex || 0) + 1} of ${total}). Resume it?`
  );

  if (!resume) {
    archiveSession(saved.role, saved.questions, saved.sessionId);
    window.MockMateStorage.clearSession();
    return;
  }

  currentSessionId = saved.sessionId || "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  currentRole = saved.role || "";
  interviewQuestions = saved.questions;
  currentIndex = Math.min(saved.currentIndex || 0, total - 1);
  renderInterviewQuestion();
  showScreen(interviewScreen);
})();

// --- Module 10: dev test mode ---
// Only ever active with BOTH ?devmode=true in the URL AND running on
// localhost — this is never something a real user stumbles into. It drives
// the real UI through real API calls (genuine Groq evaluations), it just
// fills answers automatically instead of waiting for typing/speech, so the
// full 30-question flow + report can be verified in under a couple of
// minutes instead of doing it by hand every time.
const DEV_MODE = (() => {
  try {
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const flagSet = new URLSearchParams(window.location.search).get("devmode") === "true";
    return isLocal && flagSet;
  } catch {
    return false;
  }
})();

const devPanel = document.getElementById("dev-panel");
const devRunAllBtn = document.getElementById("dev-run-all-btn");

const DEV_SAMPLE_ANSWERS = {
  personal: "I'm motivated by solving real problems and enjoy continuously learning new tools and approaches.",
  resume: "On that project I used the approach and tools described in my resume to design and ship a working feature.",
  fundamentals: "This follows the standard principle taught for this topic, applied to the situation described.",
  problem_solving: "I'd break this down into smaller steps, check edge cases, then pick the most efficient approach.",
};

function devSampleAnswer(category) {
  return DEV_SAMPLE_ANSWERS[category] || "This is a placeholder answer, used only for development testing.";
}

async function devRunAll() {
  // Loop until the completion screen actually appears — checking that
  // directly (rather than counting currentIndex) avoids any risk of
  // looping forever if a question's state is ever unexpected.
  while (completionScreen.hidden) {
    const q = interviewQuestions[currentIndex];
    if (!q) break;

    if (!q.answered) {
      answerInput.value = devSampleAnswer(q.category);
      await submitCurrentAnswer(); // genuine request to /api/evaluate-answer

      if (!evalErrorActions.hidden) {
        // Evaluation failed (rate limit, network, etc.) — don't get stuck,
        // use the same "continue without AI feedback" path a real user has.
        skipEvalBtn.click();
      }
    }

    if (!completionScreen.hidden) break;
    nextBtn.click(); // either advances, or triggers Finish on the last question

    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

if (DEV_MODE) {
  devPanel.hidden = false;

  devRunAllBtn.addEventListener("click", async () => {
    if (interviewScreen.hidden) {
      window.alert("Start an interview from the setup screen first, then click this.");
      return;
    }
    devRunAllBtn.disabled = true;
    devRunAllBtn.textContent = "Running…";
    try {
      await devRunAll();
    } finally {
      devRunAllBtn.disabled = false;
      devRunAllBtn.textContent = "Auto-run entire interview (real API calls)";
    }
  });
}