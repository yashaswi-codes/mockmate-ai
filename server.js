// server.js
// Express backend for MockMate AI.
// Module 1: serves the frontend + provides /api/generate-questions.
// The Groq API key is only ever used here, never sent to the browser.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { callGroq } = require("./groqClient");

const app = express();
const PORT = process.env.PORT || 3000;

const rateLimit = require("express-rate-limit");

// Render (and most hosts) put the app behind a proxy; without this every
// visitor would look like the same IP and share one limit.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "150kb" })); // resumes are text, this is generous
app.use(express.static(path.join(__dirname, "public")));

// Per-IP limits so a public deployment can't burn through the Groq quota.
// A full interview = 1 generate call + 30 evaluate calls.
const rateLimitMessage = { error: "Too many requests from this network. Please wait a while and try again." };
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});
const evaluateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
});
app.use("/api/generate-questions", generateLimiter);
app.use("/api/evaluate-answer", evaluateLimiter);

const CATEGORY_PLAN = [
  { key: "personal", label: "Personal", count: 5 },
  { key: "resume", label: "Resume-based", count: 8 },
  { key: "fundamentals", label: "Fundamentals", count: 10 },
  { key: "problem_solving", label: "Problem-Solving", count: 7 },
];
const TOTAL_QUESTIONS = CATEGORY_PLAN.reduce((sum, c) => sum + c.count, 0); // 30

const ROLE_MAX_LEN = 100;
const RESUME_MIN_LEN = 30;
const RESUME_MAX_LEN = 6000;

function buildQuestionPrompt(role, resume) {
  const planText = CATEGORY_PLAN.map(
    (c) => `${c.count} with category "${c.key}"`
  ).join(", ");

  const system = `You write interview questions. Output ONLY valid JSON, no markdown, no commentary, no code fences.`;

  const user = `Job role: ${role}

Candidate's resume (use ONLY facts stated here — never invent projects, companies, or skills not present in this text):
"""
${resume}
"""

Generate exactly ${TOTAL_QUESTIONS} interview questions for this candidate, split as: ${planText}.

Rules:
- "personal": general fit/motivation questions (background, strengths, goals). Not resume-specific.
- "resume": must directly reference something actually written in the resume above (a named project, tool, company, or responsibility). If the resume lacks enough detail for 8 distinct questions, ask deeper follow-up questions about the details it does contain instead of inventing new ones.
- "fundamentals": core knowledge questions appropriate to the "${role}" domain (not necessarily software — match the actual field).
- "problem_solving": these 7 questions are INDEPENDENT of the resume and must never mention the candidate's projects, skills, experience or "your ..." anything.
  * If the "${role}" is a software / engineering / data / technical role: ALL 7 must be classic Data Structures & Algorithms problems (e.g. arrays, strings, hashmaps, two pointers, stack/queue, linked lists, trees, recursion, sorting/searching, complexity). Each one must state a concrete problem with an input/output example or a constraint, and ask for the approach and its time/space complexity. Do NOT ask about system design, projects, tools, or behavioural scenarios here.
  * Otherwise (non-technical role): realistic domain-specific case/scenario questions, still independent of the resume.
- Each question is one sentence, plain text, no numbering inside the text.
- Return strict JSON matching this shape exactly:

{"questions":[{"id":1,"category":"personal","text":"..."}, ...]}

The "id" fields must run 1 to ${TOTAL_QUESTIONS} in order, grouped by category in the order personal, resume, fundamentals, problem_solving.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function validateQuestionSet(parsed) {
  if (!parsed || !Array.isArray(parsed.questions)) {
    return "Response did not contain a `questions` array.";
  }
  if (parsed.questions.length !== TOTAL_QUESTIONS) {
    return `Expected ${TOTAL_QUESTIONS} questions, got ${parsed.questions.length}.`;
  }
  const counts = {};
  for (const q of parsed.questions) {
    if (
      typeof q.id !== "number" ||
      typeof q.category !== "string" ||
      typeof q.text !== "string" ||
      !q.text.trim()
    ) {
      return "One or more questions are missing id/category/text.";
    }
    counts[q.category] = (counts[q.category] || 0) + 1;
  }
  // problem_solving questions must stand alone — if they lean on the resume,
  // the model drifted into project/personal territory, so ask for a redo.
  const resumeLeak = /\b(your (resume|project|projects|experience|skills|internship)|you (built|worked|used|developed|mentioned)|mentioned in your)\b/i;
  for (const q of parsed.questions) {
    if (q.category === "problem_solving" && resumeLeak.test(q.text)) {
      return `A "problem_solving" question refers to the candidate's own resume/projects ("${q.text.slice(0, 80)}"). Problem-solving questions must be standalone (DSA problems for technical roles) with no reference to the candidate's background.`;
    }
  }
  for (const plan of CATEGORY_PLAN) {
    if (counts[plan.key] !== plan.count) {
      return `Expected ${plan.count} "${plan.key}" questions, got ${counts[plan.key] || 0}.`;
    }
  }
  return null; // valid
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Model occasionally wraps JSON in stray text despite instructions.
    // Try to salvage the outermost {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

app.post("/api/generate-questions", async (req, res) => {
  const { role, resume } = req.body || {};

  if (typeof role !== "string" || !role.trim()) {
    return res.status(400).json({ error: "Please provide a job role." });
  }
  if (role.length > ROLE_MAX_LEN) {
    return res.status(400).json({ error: `Job role must be under ${ROLE_MAX_LEN} characters.` });
  }
  if (typeof resume !== "string" || resume.trim().length < RESUME_MIN_LEN) {
    return res.status(400).json({
      error: `Please paste your resume text (at least ${RESUME_MIN_LEN} characters) so questions can be personalized.`,
    });
  }
  if (resume.length > RESUME_MAX_LEN) {
    return res.status(400).json({
      error: `Resume text is too long. Please keep it under ${RESUME_MAX_LEN} characters.`,
    });
  }

  const messages = buildQuestionPrompt(role.trim(), resume.trim());

  try {
    let raw = await callGroq({ messages, maxTokens: 2200, jsonMode: true, temperature: 0.3 });
    let parsed = tryParseJson(raw);
    let problem = validateQuestionSet(parsed);

    // One corrective retry if the model didn't follow the schema/counts.
    if (problem) {
      const correctionMessages = [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `That response was invalid: ${problem} Return ONLY the corrected JSON object, matching the exact shape and counts requested, nothing else.`,
        },
      ];
      raw = await callGroq({ messages: correctionMessages, maxTokens: 2200, jsonMode: true, temperature: 0.3 });
      parsed = tryParseJson(raw);
      problem = validateQuestionSet(parsed);
    }

    if (problem) {
      return res.status(502).json({
        error: "Couldn't generate a valid question set right now. Please try again.",
      });
    }

    return res.json({ questions: parsed.questions });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Something went wrong." });
  }
});

// --- Module 6: answer evaluation ---

const ANSWER_MAX_LEN = 4000; // matches the textarea's maxlength on the frontend
const QUESTION_MAX_LEN = 500;
const CATEGORY_KEYS = CATEGORY_PLAN.map((c) => c.key);

function buildEvaluationPrompt(role, category, question, answer) {
  const system = `You evaluate one mock-interview answer. Output ONLY valid JSON, no markdown, no commentary, no code fences. Keep every field short — this is quick feedback, not an essay.`;

  const user = `Role: ${role}
Question category: ${category}
Question: ${question}

Candidate's answer:
"""
${answer}
"""

Evaluate this single answer and return strict JSON matching this shape exactly:

{"score":7,"strengths":"...","weaknesses":"...","improvement":"...","idealAnswerPoints":["...","...","..."]}

Rules:
- "score": integer 1-10.
- "strengths": one short sentence on what worked.
- "weaknesses": one short sentence on what was missing or weak. If there's genuinely nothing notable, say so briefly rather than inventing a flaw.
- "improvement": one concrete, actionable suggestion.
- "idealAnswerPoints": 2-4 short bullet phrases (not full sentences) a strong answer would have covered.
- Base this only on the category given (${category}) and judge accordingly — e.g. a "personal" answer isn't judged like a technical one.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function validateFeedback(parsed) {
  if (!parsed || typeof parsed !== "object") return "Response was not an object.";
  if (typeof parsed.score !== "number" || parsed.score < 1 || parsed.score > 10) {
    return "Missing or out-of-range score.";
  }
  if (typeof parsed.strengths !== "string" || !parsed.strengths.trim()) {
    return "Missing strengths.";
  }
  if (typeof parsed.weaknesses !== "string" || !parsed.weaknesses.trim()) {
    return "Missing weaknesses.";
  }
  if (typeof parsed.improvement !== "string" || !parsed.improvement.trim()) {
    return "Missing improvement suggestion.";
  }
  if (!Array.isArray(parsed.idealAnswerPoints) || parsed.idealAnswerPoints.length === 0) {
    return "Missing idealAnswerPoints.";
  }
  return null;
}

app.post("/api/evaluate-answer", async (req, res) => {
  const { role, category, question, answer } = req.body || {};

  if (typeof role !== "string" || !role.trim()) {
    return res.status(400).json({ error: "Missing role." });
  }
  if (typeof category !== "string" || !CATEGORY_KEYS.includes(category)) {
    return res.status(400).json({ error: "Missing or invalid category." });
  }
  if (typeof question !== "string" || !question.trim() || question.length > QUESTION_MAX_LEN) {
    return res.status(400).json({ error: "Missing or invalid question." });
  }
  if (typeof answer !== "string" || !answer.trim()) {
    return res.status(400).json({ error: "Please provide an answer to evaluate." });
  }
  if (answer.length > ANSWER_MAX_LEN) {
    return res.status(400).json({
      error: `Answer is too long to evaluate (max ${ANSWER_MAX_LEN} characters).`,
    });
  }

  const messages = buildEvaluationPrompt(role.trim(), category, question.trim(), answer.trim());

  try {
    let raw = await callGroq({ messages, maxTokens: 500, jsonMode: true });
    let parsed = tryParseJson(raw);
    let problem = validateFeedback(parsed);

    // One corrective retry if the model didn't follow the schema.
    if (problem) {
      const correctionMessages = [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `That response was invalid: ${problem} Return ONLY the corrected JSON object, matching the exact shape requested, nothing else.`,
        },
      ];
      raw = await callGroq({ messages: correctionMessages, maxTokens: 500, jsonMode: true });
      parsed = tryParseJson(raw);
      problem = validateFeedback(parsed);
    }

    if (problem) {
      return res.status(502).json({ error: "Couldn't evaluate that answer right now. Please try again." });
    }

    return res.json({ feedback: parsed });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || "Something went wrong." });
  }
});

// Catches malformed JSON bodies (and anything else that slips through) and
// always responds with the same clean JSON shape the frontend expects —
// never Express's default HTML error page, which would also leak a stack
// trace to the client.
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request is too large." });
  }
  console.error(err);
  return res.status(500).json({ error: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`MockMate AI running at http://localhost:${PORT}`);
});