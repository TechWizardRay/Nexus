/* =====================================================================
   NEXUS — Understand. Prioritize. Improve. Progress.
   Vanilla HTML / CSS / JavaScript only. No frameworks, no build step.

   This file is organized into the sections below. Search for the
   banner comments (====) to jump to a section.

     1. APPLICATION STATE
     2. LOCAL STORAGE
     3. ASSIGNMENTS (create / read / update / delete / derive)
     4. DATE AND TIME
     5. GEMINI API
     6. GAMIFICATION
     7. STUDY TIMER
     8. UI RENDERING
     9. EVENT HANDLERS
    10. INITIALIZATION
   ===================================================================== */


/* =====================================================================
   1. APPLICATION STATE
   A single in-memory object holding everything the UI needs to render.
   It is rebuilt from localStorage on load and kept in sync with it
   every time something changes (see section 2).
   ===================================================================== */

const state = {
  assignments: [],
  settings: null,           // { name, theme, gamification, geminiApiKey, onboarded, tutorialSeen }
  gamification: null,       // { xp }
  customSubjects: [],       // subjects the user added in Settings before using them on any assignment
  currentView: "dashboard",  // "dashboard" | "detail" | "history" | "timer" | "settings"
  currentAssignmentId: null,
  currentFilter: "all",
  currentSort: "deadline",
  currentGroupBy: "subject", // "subject" | "domain" | "none"
  searchQuery: "",
  pendingConfirmAction: null,
};


/* =====================================================================
   2. LOCAL STORAGE
   All persistence goes through these functions. Every read is
   defensive (missing/invalid data never crashes the app) and every
   write is JSON-serialized, exactly as the assignment brief asks for.
   ===================================================================== */

const STORAGE_KEYS = {
  ASSIGNMENTS: "nexus_assignments",
  SETTINGS: "nexus_settings",
  GAMIFICATION: "nexus_gamification",
  CUSTOM_SUBJECTS: "nexus_custom_subjects",
  STUDY_SESSIONS: "nexus_study_sessions",
};

function defaultSettings() {
  return {
    name: "",
    theme: "dark",
    gamification: true,
    geminiApiKey: "",
    onboarded: false,
    tutorialSeen: false,
  };
}

function defaultGamification() {
  return { xp: 0 };
}

// Generic "read JSON from localStorage, fall back safely" helper.
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    console.warn(`Nexus: could not read "${key}" from localStorage, using default.`, err);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Nexus: could not save "${key}" to localStorage.`, err);
    showToast("Could not save to this browser's storage. Your latest change may be lost on reload.", "error");
  }
}

function loadAssignments() { return readJSON(STORAGE_KEYS.ASSIGNMENTS, []); }
function saveAssignments() { writeJSON(STORAGE_KEYS.ASSIGNMENTS, state.assignments); }

function loadSettings() { return Object.assign(defaultSettings(), readJSON(STORAGE_KEYS.SETTINGS, {})); }
function saveSettings() { writeJSON(STORAGE_KEYS.SETTINGS, state.settings); }

function loadGamification() { return Object.assign(defaultGamification(), readJSON(STORAGE_KEYS.GAMIFICATION, {})); }
function saveGamification() { writeJSON(STORAGE_KEYS.GAMIFICATION, state.gamification); }

function loadCustomSubjects() { return readJSON(STORAGE_KEYS.CUSTOM_SUBJECTS, []); }
function saveCustomSubjects() { writeJSON(STORAGE_KEYS.CUSTOM_SUBJECTS, state.customSubjects); }

function loadStudySessions() { return readJSON(STORAGE_KEYS.STUDY_SESSIONS, []); }
function saveStudySessions(sessions) { writeJSON(STORAGE_KEYS.STUDY_SESSIONS, sessions); }


/* =====================================================================
   3. ASSIGNMENTS
   CRUD helpers plus the pure functions that derive filters, sorting,
   statistics and the "Your Next Move" recommendation from the data.
   ===================================================================== */

function generateId() {
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function addTimelineEvent(assignment, eventName, detail = "") {
  assignment.timeline.push({ event: eventName, timestamp: new Date().toISOString(), detail });
}

function createAssignmentFromForm(formValues) {
  const nowISO = new Date().toISOString();
  const assignment = {
    id: generateId(),
    title: formValues.title.trim(),
    description: (formValues.description || "").trim(),
    domain: (formValues.domain || "").trim(),
    subject: (formValues.subject || "").trim(),
    postedBy: (formValues.postedBy || "").trim(),
    postedDate: formValues.postedDate || nowISO.slice(0, 10),
    deadline: formValues.deadline,
    estimatedEffort: (formValues.estimatedEffort || "").trim(),
    notes: (formValues.notes || "").trim(),
    status: formValues.status || "not-started",
    card: "none",
    review: { feedback: "", reviewedDate: null, analysis: null },
    aiAnalysis: null,
    timeline: [],
    createdAt: nowISO,
    updatedAt: nowISO,
  };
  addTimelineEvent(assignment, "Assignment created");
  return assignment;
}

function getAssignmentById(id) {
  return state.assignments.find((a) => a.id === id) || null;
}

function touchAssignment(assignment) {
  assignment.updatedAt = new Date().toISOString();
}

// "Locked" assignments (drip-fed content not yet unlocked) aren't
// actionable yet, so they're treated like "completed" for the purposes
// of overdue/due-soon/next-move — they just sit quietly until unlocked.
function isActionable(assignment) {
  return assignment.status !== "completed" && assignment.status !== "locked";
}

function isOverdue(assignment) {
  return isActionable(assignment) && new Date(assignment.deadline).getTime() < Date.now();
}

function isDueSoon(assignment, windowHours = 48) {
  if (!isActionable(assignment) || isOverdue(assignment)) return false;
  const hoursLeft = (new Date(assignment.deadline).getTime() - Date.now()) / 3600000;
  return hoursLeft >= 0 && hoursLeft <= windowHours;
}

function isReviewRequired(assignment) {
  return assignment.status === "submitted" && assignment.card === "none";
}

function computeStats(assignments) {
  return {
    active: assignments.filter((a) => isActionable(a)).length,
    dueSoon: assignments.filter((a) => isDueSoon(a)).length,
    reviewRequired: assignments.filter((a) => isReviewRequired(a)).length,
    completed: assignments.filter((a) => a.status === "completed").length,
  };
}

function filterAssignments(assignments, filter) {
  switch (filter) {
    case "active": return assignments.filter((a) => isActionable(a));
    case "due-soon": return assignments.filter((a) => isDueSoon(a));
    case "review-required": return assignments.filter((a) => isReviewRequired(a));
    case "completed": return assignments.filter((a) => a.status === "completed");
    case "overdue": return assignments.filter((a) => isOverdue(a));
    case "locked": return assignments.filter((a) => a.status === "locked");
    default: return assignments.slice();
  }
}

function searchAssignments(assignments, query) {
  const q = query.trim().toLowerCase();
  if (!q) return assignments;
  return assignments.filter((a) => {
    const haystack = [
      a.title, a.description, a.domain, a.subject, a.notes, a.review.feedback,
    ].join(" \n ").toLowerCase();
    return haystack.includes(q);
  });
}

const STATUS_ORDER = ["not-started", "in-progress", "submitted", "completed", "locked"];

function sortAssignments(assignments, sortKey) {
  const list = assignments.slice();
  switch (sortKey) {
    case "recently-added":
      return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    case "recently-updated":
      return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    case "status":
      return list.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        || new Date(a.deadline) - new Date(b.deadline));
    case "deadline":
    default:
      return list.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  }
}

// Deterministic "Your Next Move" recommendation. Gemini is only ever
// used afterwards to *explain* this pick in natural language — never
// to choose it. See section 5.
function pickNextMove(assignments) {
  const candidates = assignments.filter((a) => isActionable(a));
  if (candidates.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const a of candidates) {
    let score = 0;
    const reasons = [];

    if (isOverdue(a)) { score += 100; reasons.push("overdue"); }
    if (isDueSoon(a)) { score += 50; reasons.push("due-soon"); }
    if (isReviewRequired(a)) { score += 20; reasons.push("review-required"); }
    if (a.card === "yellow" || a.card === "red") { score += 30; reasons.push("needs-improvement"); }
    if (a.status === "not-started") { score += 10; reasons.push("not-started"); }

    const hoursLeft = (new Date(a.deadline).getTime() - Date.now()) / 3600000;
    score += Math.max(0, 72 - Math.min(hoursLeft, 72)) * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = { assignment: a, reasons };
    }
  }
  return best;
}

function buildNextMoveExplanation(pick, allAssignments) {
  const { assignment, reasons } = pick;
  const completedCount = allAssignments.filter((a) => a.status === "completed").length;

  if (reasons.includes("overdue")) {
    return `This assignment is overdue — it needs attention before anything else.`;
  }
  if (reasons.includes("needs-improvement")) {
    return `This assignment came back with a ${assignment.card} card. Addressing the feedback keeps it from slipping further.`;
  }
  if (reasons.includes("due-soon")) {
    return `You've completed ${completedCount} assignment${completedCount === 1 ? "" : "s"} so far. This one has the nearest deadline.`;
  }
  if (reasons.includes("review-required")) {
    return `This assignment is submitted and waiting on a review — worth checking in on.`;
  }
  return `This assignment hasn't been started yet and is next in line by deadline.`;
}


/* =====================================================================
   4. DATE AND TIME
   All date/time formatting funnels through here. The countdown
   interval only rewrites the small DOM nodes tagged with
   [data-countdown], never the whole page — see startTimeLoops().
   ===================================================================== */

function formatDeadlineCountdown(deadlineISO, status) {
  if (status === "completed") return "Completed";
  if (status === "locked") return "Locked";
  const diffMs = new Date(deadlineISO).getTime() - Date.now();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);

  const totalMinutes = Math.floor(abs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  let text;
  if (days > 0) text = `${days}d ${hours}h ${minutes}m`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else text = `${minutes}m`;

  return overdue ? `Overdue by ${text}` : `Due in ${text}`;
}

function countdownClass(deadlineISO, status) {
  if (status === "completed" || status === "locked") return "";
  const diffMs = new Date(deadlineISO).getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  if (diffMs <= 48 * 3600 * 1000) return "due-soon";
  return "";
}

function formatRelativeTime(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let value, unit;
  if (seconds < 60) { value = seconds; unit = "second"; }
  else if (minutes < 60) { value = minutes; unit = "minute"; }
  else if (hours < 24) { value = hours; unit = "hour"; }
  else if (days < 30) { value = days; unit = "day"; }
  else { value = Math.floor(days / 30); unit = "month"; }

  const plural = value === 1 ? unit : `${unit}s`;
  return future ? `in ${value} ${plural}` : `${value} ${plural} ago`;
}

function formatDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function updateCountdowns() {
  document.querySelectorAll("[data-countdown-deadline]").forEach((el) => {
    const deadline = el.getAttribute("data-countdown-deadline");
    const status = el.getAttribute("data-countdown-status");
    el.textContent = formatDeadlineCountdown(deadline, status);
    el.className = `countdown ${countdownClass(deadline, status)}`.trim();
  });
}

function updateRelativeTimestamps() {
  document.querySelectorAll("[data-relative-time]").forEach((el) => {
    el.textContent = formatRelativeTime(el.getAttribute("data-relative-time"));
  });
}

function startTimeLoops() {
  updateCountdowns();
  updateRelativeTimestamps();
  setInterval(updateCountdowns, 1000);
  setInterval(updateRelativeTimestamps, 60000);
  setInterval(tickStudyTimer, 1000);
}


/* =====================================================================
   5. GEMINI API
   A single generic caller plus task-specific prompt builders.
   Responses are requested as JSON and parsed defensively; if parsing
   fails we still show the raw text rather than losing the response.

   SECURITY NOTE: the API key lives in this browser's localStorage and
   is sent directly to Google from the browser, because this is a
   frontend-only student assignment. That is NOT a safe pattern for a
   real production app — a real deployment must proxy this call
   through a server that holds the key. See README.md.
   ===================================================================== */

const GEMINI_MODEL_CANDIDATES = ["gemini-3.6-flash"];
let workingGeminiModel = null;

function geminiEndpoint(apiKey, model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

async function callGeminiJSON(systemInstruction, userPrompt) {
  const apiKey = (state.settings.geminiApiKey || "").trim();
  if (!apiKey) {
    return { ok: false, message: "No Gemini API key is set. Add one in Settings to use the AI mentor." };
  }

  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
  });

  const modelsToTry = workingGeminiModel
    ? [workingGeminiModel, ...GEMINI_MODEL_CANDIDATES.filter((m) => m !== workingGeminiModel)]
    : GEMINI_MODEL_CANDIDATES;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let response, lastNotFoundMessage = "";
  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await fetch(geminiEndpoint(apiKey, model), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
        });
      } catch (networkErr) {
        return { ok: false, message: "Mentor couldn't reach the network. Check your internet connection — your assignment is still safely saved locally." };
      }
      if (response.status === 503 && attempt === 1) { await sleep(2000); continue; }
      break;
    }

    if (response.ok) { workingGeminiModel = model; break; }

    let apiMessage = "";
    try {
      const errorPayload = await response.json();
      apiMessage = errorPayload?.error?.message || "";
    } catch { /* body wasn't JSON — fall through with no extra detail */ }
    console.error("Nexus: Gemini API error", model, response.status, apiMessage);

    if (response.status === 404) { lastNotFoundMessage = apiMessage; continue; }

    if (response.status === 503) {
      return { ok: false, message: "Gemini's servers are overloaded with traffic right now. Please try again in a minute — your assignment is still safely saved locally." };
    }
    if (response.status === 429) {
      return { ok: false, message: "The Gemini API rate limit was reached. Please wait a moment and try again." };
    }
    if (response.status === 400 || response.status === 403) {
      return { ok: false, message: `Gemini rejected the request (${apiMessage || "the API key may be invalid"}). Check it in Settings.` };
    }
    return { ok: false, message: `Mentor couldn't analyze this right now: ${apiMessage || `error ${response.status}`}. Your assignment is still safely saved locally.` };
  }

  if (!response.ok) {
    return { ok: false, message: `None of the usual Gemini models were available for this API key (${lastNotFoundMessage || "not found"}). Make sure this is a Gemini API key from aistudio.google.com/apikey, not a different Google API key.` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return { ok: false, message: "Mentor received an unreadable response. Please try again." };
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text.trim()) {
    return { ok: false, message: "Mentor's response came back empty. Please try again." };
  }

  const parsed = parseJSONLoosely(text);
  if (parsed) return { ok: true, data: parsed, raw: text };
  return { ok: true, data: { summary: text }, raw: text };
}

function parseJSONLoosely(text) {
  const cleaned = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function buildAssignmentAnalysisPrompt(assignment) {
  return `Assignment title: ${assignment.title}
Subject: ${assignment.subject || "Not specified"}
Description: ${assignment.description || "No description provided."}
Estimated effort: ${assignment.estimatedEffort || "Not specified"}
Notes from the student: ${assignment.notes || "None"}

Explain this assignment to the student. Respond with ONLY a JSON object matching exactly this shape:
{
  "summary": "one or two plain-English sentences on what this assignment actually asks for",
  "requirements": ["explicit, required items the student must deliver"],
  "constraints": ["explicit limits, formats, or rules mentioned or implied"],
  "suggestedApproach": ["a reasonable, step-by-step way to tackle it"],
  "extraMileIdeas": ["OPTIONAL ideas that go beyond the minimum — never required work"]
}
Do not do the assignment for the student. Do not invent requirements that are not supported by the text. Keep each array item concise.`;
}

function buildReviewAnalysisPrompt(assignment) {
  return `A student submitted "${assignment.title}" and received this reviewer feedback (card: ${assignment.card}):
"""${assignment.review.feedback}"""

Analyze ONLY this feedback. Respond with ONLY a JSON object matching exactly this shape:
{
  "expectedByReviewer": "1-2 sentences starting with 'The feedback appears to indicate...' describing what the reviewer seems to expect",
  "improvementAreas": ["concrete, specific areas to improve, grounded only in the feedback given"],
  "checklist": ["actionable checklist items to complete before the next submission"]
}
Do not invent expectations the feedback does not support.`;
}

async function analyzeAssignmentWithAI(assignment, forceRefresh) {
  const sourceHash = hashString(assignment.title + "|" + assignment.description + "|" + assignment.subject);
  if (!forceRefresh && assignment.aiAnalysis && assignment.aiAnalysis.sourceHash === sourceHash) {
    return { ok: true, cached: true };
  }
  const result = await callGeminiJSON(
    "You are Nexus's academic mentor: a supportive, concise explainer who helps students understand assignments without ever completing the work for them.",
    buildAssignmentAnalysisPrompt(assignment)
  );
  if (!result.ok) return result;

  assignment.aiAnalysis = {
    summary: result.data.summary || "",
    requirements: result.data.requirements || [],
    constraints: result.data.constraints || [],
    suggestedApproach: result.data.suggestedApproach || [],
    extraMileIdeas: result.data.extraMileIdeas || [],
    generatedDate: new Date().toISOString(),
    sourceHash,
  };
  touchAssignment(assignment);
  saveAssignments();
  return { ok: true, cached: false };
}

async function analyzeReviewWithAI(assignment, forceRefresh) {
  const sourceHash = hashString(assignment.review.feedback + "|" + assignment.card);
  if (!forceRefresh && assignment.review.analysis && assignment.review.analysis.sourceHash === sourceHash) {
    return { ok: true, cached: true };
  }
  const result = await callGeminiJSON(
    "You are Nexus's academic mentor. You turn reviewer feedback into a clear, actionable improvement plan without overstating what the feedback actually says.",
    buildReviewAnalysisPrompt(assignment)
  );
  if (!result.ok) return result;

  assignment.review.analysis = {
    expectedByReviewer: result.data.expectedByReviewer || "",
    improvementAreas: result.data.improvementAreas || [],
    checklist: result.data.checklist || [],
    generatedDate: new Date().toISOString(),
    sourceHash,
  };
  touchAssignment(assignment);
  addTimelineEvent(assignment, "Review analyzed");
  saveAssignments();
  return { ok: true, cached: false };
}

async function explainNextMoveWithAI(pick) {
  const { assignment, reasons } = pick;
  const prompt = `Assignment: ${assignment.title} (subject: ${assignment.subject || "n/a"})
Deadline: ${assignment.deadline}
Status: ${assignment.status}
Review card: ${assignment.card}
Deterministic reasons this was picked as the next priority: ${reasons.join(", ")}

In ONE short, encouraging sentence (max 30 words), explain to the student why this should be their next move. Respond with ONLY this JSON shape:
{ "explanation": "..." }`;
  const result = await callGeminiJSON(
    "You are Nexus's academic mentor: warm, brief, and practical. You explain a priority decision that a deterministic system already made — you do not change the decision.",
    prompt
  );
  if (!result.ok) return result;
  return { ok: true, explanation: result.data.explanation || result.data.summary || "" };
}

async function explainProgressWithAI(groupLabel, stats) {
  const prompt = `Category: ${groupLabel}
Completed ${stats.completed} of ${stats.total} assignments (${stats.pct}%).

In ONE short, encouraging and motivating sentence (max 22 words) for the student about their progress in this specific category. Respond with ONLY this JSON shape:
{ "line": "..." }`;
  const result = await callGeminiJSON(
    "You are Nexus's academic mentor: warm, brief, and encouraging about a student's progress in one specific subject or category. Never invent numbers beyond what's given.",
    prompt
  );
  if (!result.ok) return result;
  return { ok: true, line: result.data.line || result.data.summary || "" };
}


/* =====================================================================
   6. GAMIFICATION
   Optional and subtle by design. XP is the only value persisted;
   badges and levels are derived on the fly from current data.
   ===================================================================== */

const XP_REWARDS = {
  completeAssignment: 50,
  firstAnalysis: 10,
  saveReview: 15,
  analyzeReview: 10,
  completeStudySession: 20,
};

function awardXP(amount) {
  if (!state.settings.gamification || amount <= 0) return;
  state.gamification.xp += amount;
  saveGamification();
  showToast(`+${amount} XP`, "info");
}

function levelFromXP(xp) {
  return Math.floor(xp / 150) + 1;
}

function xpProgressPercent(xp) {
  return Math.round(((xp % 150) / 150) * 100);
}

const LEVEL_TITLES = [
  { min: 1, max: 9, title: "Rookie" },
  { min: 10, max: 19, title: "Apprentice" },
  { min: 20, max: 29, title: "Scholar" },
  { min: 30, max: 39, title: "Strategist" },
  { min: 40, max: 49, title: "Veteran" },
  { min: 50, max: 59, title: "Specialist" },
  { min: 60, max: 69, title: "Expert" },
  { min: 70, max: 79, title: "Virtuoso" },
  { min: 80, max: 89, title: "Master" },
  { min: 90, max: Infinity, title: "Legend" },
];

function titleForLevel(level) {
  return (LEVEL_TITLES.find((t) => level >= t.min && level <= t.max) || LEVEL_TITLES[0]).title;
}

function computeEarnedBadges() {
  const badges = [];
  const completedCount = state.assignments.filter((a) => a.status === "completed").length;
  const greenCount = state.assignments.filter((a) => a.card === "green").length;
  const analyzedCount = state.assignments.filter((a) => a.aiAnalysis).length;
  const sessionCount = loadStudySessions().length;

  if (state.assignments.length >= 1) badges.push({ id: "first-steps", label: "First Steps" });
  if (completedCount >= 1) badges.push({ id: "finisher", label: "Finisher" });
  if (completedCount >= 5) badges.push({ id: "high-achiever", label: "High Achiever" });
  if (greenCount >= 3) badges.push({ id: "green-streak", label: "Green Streak" });
  if (analyzedCount >= 3) badges.push({ id: "mentors-favorite", label: "Mentor's Favorite" });
  if (sessionCount >= 5) badges.push({ id: "focused", label: "Focused" });
  return badges;
}


/* =====================================================================
   7. STUDY TIMER
   A simple preset countdown with a tree that grows through visible
   stages as the session progresses. Only fully-completed sessions are
   logged; pausing/stopping early logs nothing.
   ===================================================================== */

const TIMER_PRESETS = [15, 25, 45, 60];

const timerState = {
  running: false,
  durationMinutes: 25,
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  intervalId: null,
};

function timerTreeStage(fractionElapsed) {
  if (fractionElapsed >= 0.85) return 4;
  if (fractionElapsed >= 0.6) return 3;
  if (fractionElapsed >= 0.4) return 2;
  if (fractionElapsed >= 0.2) return 1;
  return 0;
}

function startStudyTimer(minutes) {
  if (timerState.running) return;
  if (minutes) {
    timerState.durationMinutes = minutes;
    timerState.totalSeconds = minutes * 60;
    timerState.remainingSeconds = minutes * 60;
  }
  timerState.running = true;
  renderTimerView();
}

function pauseStudyTimer() {
  timerState.running = false;
  renderTimerView();
}

function stopStudyTimer() {
  timerState.running = false;
  timerState.remainingSeconds = timerState.totalSeconds;
  renderTimerView();
}

function tickStudyTimer() {
  if (!timerState.running) return;
  timerState.remainingSeconds -= 1;
  if (timerState.remainingSeconds <= 0) {
    completeStudySession();
    return;
  }
  updateTimerDisplay();
}

function completeStudySession() {
  timerState.running = false;
  const sessions = loadStudySessions();
  sessions.push({ date: new Date().toISOString().slice(0, 10), durationMinutes: timerState.durationMinutes });
  saveStudySessions(sessions);
  timerState.remainingSeconds = timerState.totalSeconds;
  awardXP(XP_REWARDS.completeStudySession);
  showToast("Session complete — your tree is fully grown 🌳", "success");
  renderTimerView();
}

function computeStudyStats() {
  const sessions = loadStudySessions();
  const perDay = {};
  sessions.forEach((s) => { perDay[s.date] = (perDay[s.date] || 0) + 1; });
  const bestDay = Object.values(perDay).reduce((max, n) => Math.max(max, n), 0);
  return { totalSessions: sessions.length, bestDay, sessions };
}


/* =====================================================================
   8. UI RENDERING
   Pure(-ish) DOM-building functions. Everything reads from `state`
   and writes into the DOM; nothing here mutates assignment data.
   ===================================================================== */

function $(selector, root = document) { return root.querySelector(selector); }
function $all(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function iconTag(name, size = 14) {
  return `<svg class="icon" width="${size}" height="${size}"><use href="#icon-${name}"></use></svg>`;
}

function dotTag(card) {
  return `<span class="status-dot dot-${card}"></span>`;
}

// ---- Theme -----------------------------------------------------------
// Moon/sun swap is pure CSS (see html[data-theme] rules); this just
// flips the attribute that everything else keys off of.
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
}

// ---- Toasts ------------------------------------------------------------

function showToast(message, type = "info") {
  const container = $("#toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3800);
}

// ---- Modals --------------------------------------------------------------

function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  $(`#${id}`).classList.add("hidden");
  document.body.style.overflow = "";
}
function closeAllModals() {
  $all(".modal-overlay").forEach((m) => m.classList.add("hidden"));
  document.body.style.overflow = "";
}

function showConfirm(title, message, onConfirm, confirmLabel = "Confirm") {
  $("#modal-confirm-title").textContent = title;
  $("#modal-confirm-message").textContent = message;
  const btn = $("#modal-confirm-action-btn");
  btn.textContent = confirmLabel;
  state.pendingConfirmAction = onConfirm;
  openModal("modal-confirm");
}

// ---- View switching --------------------------------------------------

function showView(viewName) {
  state.currentView = viewName;
  $all(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${viewName}`).classList.remove("hidden");
  $all(".sidebar-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === viewName));
  window.scrollTo({ top: 0, behavior: "instant" in window.scrollTo ? "instant" : "auto" });
}

// ---- Greeting ----------------------------------------------------------

function renderGreeting() {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  $("#greeting-text").textContent = `${timeGreeting}${state.settings.name ? ", " + state.settings.name : ""}.`;
  $("#greeting-sub").textContent = "Here's what needs your attention.";
}

// ---- Level widget (main dashboard) --------------------------------------

function renderLevelWidget() {
  const el = $("#level-widget");
  if (!state.settings.gamification) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const xp = state.gamification.xp;
  const level = levelFromXP(xp);
  el.innerHTML = `
    <div class="level-widget-badge">${level}</div>
    <div class="level-widget-info">
      <div class="level-widget-title">Level ${level} · ${titleForLevel(level)}</div>
      <div class="level-widget-sub">${xp} XP total</div>
      <div class="level-widget-bar-track"><div class="level-widget-bar-fill" style="width:${xpProgressPercent(xp)}%"></div></div>
    </div>
  `;
}

// ---- Summary cards -----------------------------------------------------

function renderSummaryCards() {
  const stats = computeStats(state.assignments);
  const cards = [
    { label: "Active assignments", value: stats.active },
    { label: "Due soon", value: stats.dueSoon },
    { label: "Review required", value: stats.reviewRequired },
    { label: "Completed", value: stats.completed },
  ];
  $("#summary-cards").innerHTML = cards.map((c) => `
    <div class="stat-card accent">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div>
  `).join("");
}

// ---- Next move -----------------------------------------------------------

function renderNextMove() {
  const container = $("#next-move-card");
  const pick = pickNextMove(state.assignments);

  if (!pick) {
    container.innerHTML = `
      <div class="next-move-eyebrow">Your next move</div>
      <p class="next-move-empty">You're all caught up! Add a new assignment or enjoy the moment.</p>
    `;
    return;
  }

  const { assignment } = pick;
  const explanation = buildNextMoveExplanation(pick, state.assignments);

  container.innerHTML = `
    <div class="next-move-eyebrow">Your next move · Mentor recommends</div>
    <div class="next-move-title">${escapeHTML(assignment.title)}</div>
    <div class="next-move-meta">
      <span data-countdown-deadline="${assignment.deadline}" data-countdown-status="${assignment.status}" class="countdown"></span>
      <span>·</span>
      <span>${escapeHTML(statusLabel(assignment.status))}</span>
    </div>
    <div class="next-move-quote" id="next-move-explanation">"${escapeHTML(explanation)}"</div>
    <div class="next-move-actions">
      <button class="btn btn-primary" data-action="open-assignment" data-id="${assignment.id}">Open assignment</button>
      <button class="btn btn-ghost" id="next-move-ai-btn" data-action="explain-next-move" data-id="${assignment.id}">${iconTag("sparkle", 13)} Ask Mentor to explain</button>
    </div>
  `;
}

// ---- Status / card labels -------------------------------------------

function statusLabel(status) {
  return { "not-started": "Not started", "in-progress": "In progress", "submitted": "Submitted", "completed": "Completed", "locked": "Locked" }[status] || status;
}
function cardLabel(card) {
  return { green: "Green card", yellow: "Yellow card", red: "Red card", none: "No review yet" }[card] || "No review yet";
}

// ---- Assignment list / cards ------------------------------------------

function renderAssignmentList() {
  let list = filterAssignments(state.assignments, state.currentFilter);
  list = searchAssignments(list, state.searchQuery);
  list = sortAssignments(list, state.currentSort);

  const container = $("#assignment-list");
  const emptyState = $("#empty-state");

  if (state.assignments.length === 0) {
    container.innerHTML = "";
    container.classList.add("hidden");
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  container.classList.remove("hidden");

  if (list.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);">No assignments match this view.</p>`;
    return;
  }

  container.innerHTML = groupAssignmentsHTML(list, state.currentGroupBy);
}

// User-defined categories: group by whichever field the student
// actually uses (subject/course, or a broader domain), or not at all.
function groupAssignmentsHTML(list, groupField) {
  if (groupField === "none") {
    return `<div class="assignment-group-grid">${list.map(renderAssignmentCardHTML).join("")}</div>`;
  }

  const groups = new Map();
  for (const a of list) {
    const key = (a[groupField] || "").trim() || "General";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }

  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "General") return 1;
    if (b === "General") return -1;
    return a.localeCompare(b);
  });

  return orderedKeys.map((key) => `
    <section class="assignment-group">
      <div class="assignment-group-header">
        <span class="assignment-group-title">${escapeHTML(key)}</span>
        <span class="assignment-group-count">${groups.get(key).length}</span>
      </div>
      <div class="assignment-group-grid">${groups.get(key).map(renderAssignmentCardHTML).join("")}</div>
    </section>
  `).join("");
}

function renderAssignmentCardHTML(a) {
  const overdue = isOverdue(a);
  const cardClass = a.status === "locked" ? "card-locked" : overdue ? "card-overdue" : `card-${a.card}`;
  return `
    <div class="assignment-card ${cardClass}" data-action="open-assignment" data-id="${a.id}" role="button" tabindex="0" aria-label="Open ${escapeHTML(a.title)}">
      <div class="assignment-card-top">
        <div>
          <div class="assignment-card-subject">${escapeHTML(a.subject || "General")}</div>
          <div class="assignment-card-title">${escapeHTML(a.title)}</div>
        </div>
      </div>
      <div class="assignment-card-meta">
        <span data-countdown-deadline="${a.deadline}" data-countdown-status="${a.status}" class="countdown"></span>
        <span>Deadline: ${formatDateShort(a.deadline)}</span>
      </div>
      <div class="assignment-card-footer">
        <span class="badge badge-status-${a.status}">${a.status === "locked" ? iconTag("lock", 11) + " " : ""}${statusLabel(a.status)}</span>
        <span class="badge badge-card-${a.card}">${dotTag(a.card)} ${cardLabel(a.card)}</span>
        ${overdue ? `<span class="badge badge-overdue">Overdue</span>` : ""}
      </div>
    </div>
  `;
}

// ---- Detail view ---------------------------------------------------------

function renderDetailView(assignment) {
  const container = $("#detail-content");
  if (!assignment) {
    container.innerHTML = `<p>This assignment could not be found. It may have been deleted.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="detail-header">
      <div class="assignment-card-subject">${escapeHTML(assignment.domain ? `${assignment.domain} · ${assignment.subject || "General"}` : (assignment.subject || "General"))}</div>
      <h1 class="detail-title">${escapeHTML(assignment.title)}</h1>
      ${assignment.description ? `<p>${escapeHTML(assignment.description)}</p>` : ""}
      <div class="detail-meta-grid">
        <div class="detail-meta-item">
          <div class="meta-label">Category</div>
          <div class="meta-value">${escapeHTML(assignment.domain || "—")}</div>
        </div>
        <div class="detail-meta-item">
          <div class="meta-label">Posted date</div>
          <div class="meta-value">${formatDateShort(assignment.postedDate)}</div>
        </div>
        <div class="detail-meta-item">
          <div class="meta-label">Posted by</div>
          <div class="meta-value">${escapeHTML(assignment.postedBy || "—")}</div>
        </div>
        <div class="detail-meta-item">
          <div class="meta-label">Deadline</div>
          <div class="meta-value">${formatDateShort(assignment.deadline)}</div>
        </div>
        <div class="detail-meta-item">
          <div class="meta-label">Time remaining</div>
          <div class="meta-value"><span data-countdown-deadline="${assignment.deadline}" data-countdown-status="${assignment.status}" class="countdown"></span></div>
        </div>
        <div class="detail-meta-item">
          <div class="meta-label">Status</div>
          <div class="meta-value">
            <select id="detail-status-select" data-id="${assignment.id}">
              <option value="not-started" ${assignment.status === "not-started" ? "selected" : ""}>Not started</option>
              <option value="in-progress" ${assignment.status === "in-progress" ? "selected" : ""}>In progress</option>
              <option value="submitted" ${assignment.status === "submitted" ? "selected" : ""}>Submitted</option>
              <option value="completed" ${assignment.status === "completed" ? "selected" : ""}>Completed</option>
              <option value="locked" ${assignment.status === "locked" ? "selected" : ""}>Locked</option>
            </select>
          </div>
        </div>
        <div class="detail-meta-item">
          <div class="meta-label">Card</div>
          <div class="meta-value">${dotTag(assignment.card)} ${cardLabel(assignment.card)}</div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-secondary" data-action="edit-assignment" data-id="${assignment.id}">Edit</button>
        <button class="btn btn-danger" data-action="delete-assignment" data-id="${assignment.id}">Delete</button>
      </div>
    </div>

    ${renderAIBreakdownSectionHTML(assignment)}
    ${renderReviewSectionHTML(assignment)}
    ${renderTimelineSectionHTML(assignment)}
  `;
}

function renderAIBreakdownSectionHTML(assignment) {
  const a = assignment.aiAnalysis;
  const analyzeBtn = `<button class="btn btn-primary" data-action="analyze-assignment" data-id="${assignment.id}">${a ? "Re-analyze" : "Analyze with Mentor"}</button>`;

  if (!a) {
    return `
      <section class="detail-section">
        <h2>${iconTag("sparkle", 16)} AI Breakdown</h2>
        <p class="detail-section-sub">Ask the mentor to explain what this assignment actually requires.</p>
        ${analyzeBtn}
        <div id="assignment-analysis-status"></div>
      </section>
    `;
  }

  return `
    <section class="detail-section">
      <h2>${iconTag("sparkle", 16)} AI Breakdown</h2>
      <p class="detail-section-sub">Generated ${formatRelativeTime(a.generatedDate)}</p>
      <div class="ai-block">
        <h3>Summary</h3>
        <p>${escapeHTML(a.summary)}</p>
      </div>
      ${a.requirements.length ? `<div class="ai-block"><h3>Required</h3><ul>${a.requirements.map((r) => `<li>${escapeHTML(r)}</li>`).join("")}</ul></div>` : ""}
      ${a.constraints.length ? `<div class="ai-block"><h3>Constraints</h3><ul>${a.constraints.map((r) => `<li>${escapeHTML(r)}</li>`).join("")}</ul></div>` : ""}
      ${a.suggestedApproach.length ? `<div class="ai-block"><h3>Suggested approach</h3><ul>${a.suggestedApproach.map((r) => `<li>${escapeHTML(r)}</li>`).join("")}</ul></div>` : ""}
      ${a.extraMileIdeas.length ? `
        <div class="ai-block">
          <h3>Go the extra mile <span class="required-badge-inline">(optional — not required)</span></h3>
          <div class="extra-mile-block"><ul>${a.extraMileIdeas.map((r) => `<li>${escapeHTML(r)}</li>`).join("")}</ul></div>
        </div>` : ""}
      ${analyzeBtn}
      <div id="assignment-analysis-status"></div>
    </section>
  `;
}

function renderReviewSectionHTML(assignment) {
  const r = assignment.review;
  const hasFeedback = r.feedback && r.feedback.trim().length > 0;

  return `
    <section class="detail-section">
      <h2>${iconTag("tag", 16)} Review</h2>
      <div class="review-summary">
        <span class="badge badge-card-${assignment.card}">${dotTag(assignment.card)} ${cardLabel(assignment.card)}</span>
        ${r.reviewedDate ? `<span data-relative-time="${r.reviewedDate}" style="color:var(--text-muted); font-size:0.85rem;"></span>` : ""}
        <button class="btn btn-secondary btn-small" data-action="open-review-modal" data-id="${assignment.id}">${hasFeedback ? "Edit review" : "Record review"}</button>
      </div>
      ${hasFeedback ? `<div class="review-feedback-box">${escapeHTML(r.feedback)}</div>` : `<p>No reviewer feedback recorded yet.</p>`}

      ${hasFeedback ? renderReviewAnalysisHTML(assignment) : ""}
    </section>
  `;
}

function renderReviewAnalysisHTML(assignment) {
  const a = assignment.review.analysis;
  const btn = `<button class="btn btn-primary btn-small" data-action="analyze-review" data-id="${assignment.id}">${a ? "Re-analyze review" : "Analyze Review"}</button>`;

  if (!a) {
    return `<div style="margin-top:14px;">${btn}<div id="review-analysis-status"></div></div>`;
  }

  return `
    <div class="ai-block" style="margin-top:16px;">
      <h3>AI review analysis</h3>
      <p>${escapeHTML(a.expectedByReviewer)}</p>
      ${a.improvementAreas.length ? `<h3>Improvement areas</h3><ul>${a.improvementAreas.map((x) => `<li>${escapeHTML(x)}</li>`).join("")}</ul>` : ""}
      ${a.checklist.length ? `<h3>Next submission checklist</h3><ul>${a.checklist.map((x) => `<li>${escapeHTML(x)}</li>`).join("")}</ul>` : ""}
      ${btn}
      <div id="review-analysis-status"></div>
    </div>
  `;
}

function renderTimelineSectionHTML(assignment) {
  const events = assignment.timeline.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return `
    <section class="detail-section">
      <h2>Timeline</h2>
      <ul class="timeline">
        ${events.map((e) => `
          <li>
            <div class="timeline-event-label">${escapeHTML(e.event)}${e.detail ? ` — ${escapeHTML(e.detail)}` : ""}</div>
            <div class="timeline-event-time" data-relative-time="${e.timestamp}"></div>
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

// ---- History / progress view -------------------------------------------

const REPORT_CARD_META = {
  green: { label: "Green", note: "Consistently on target" },
  yellow: { label: "Yellow", note: "Getting there — refine and resubmit" },
  red: { label: "Red", note: "Needs focused attention" },
};

function computeGroupStats(assignments, groupField) {
  const groups = new Map();
  for (const a of assignments) {
    const key = (a[groupField] || "").trim() || "General";
    if (!groups.has(key)) groups.set(key, { total: 0, completed: 0 });
    const g = groups.get(key);
    g.total++;
    if (a.status === "completed") g.completed++;
  }
  return Array.from(groups.entries())
    .map(([name, g]) => ({ name, total: g.total, completed: g.completed, pct: g.total ? Math.round((g.completed / g.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

const categoryAICache = {};

function renderHistoryView() {
  const container = $("#history-content");
  const all = state.assignments;
  const completed = all.filter((a) => a.status === "completed").length;
  const reviewed = all.filter((a) => a.card !== "none");
  const distribution = {
    green: all.filter((a) => a.card === "green").length,
    yellow: all.filter((a) => a.card === "yellow").length,
    red: all.filter((a) => a.card === "red").length,
  };

  const themes = extractFeedbackThemes(all);
  const subjectStats = computeGroupStats(all, "subject");
  const domainStats = computeGroupStats(all, "domain");

  const renderCategoryBlock = (fieldKey, stats) => stats.map((s) => {
    const cacheKey = `${fieldKey}:${s.name}:${s.completed}:${s.total}`;
    const cached = categoryAICache[cacheKey];
    const fallback = `Keep going in ${s.name} — ${s.pct}% complete.`;
    return `
      <div class="category-progress-block">
        <div class="category-progress-head">
          <span class="category-progress-name">${escapeHTML(s.name)}</span>
          <span class="category-progress-pct">${s.pct}%</span>
        </div>
        <div class="category-progress-track"><div class="category-progress-fill" style="width:${s.pct}%"></div></div>
        <p class="category-progress-ai" data-category-ai="${cacheKey}">${escapeHTML(cached || fallback)}</p>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="history-grid">
      <div class="stat-card">
        <div class="stat-value">${all.length}</div>
        <div class="stat-label">Total assignments</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-value">${completed}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${all.length ? Math.round((completed / all.length) * 100) : 0}%</div>
        <div class="stat-label">Completion rate</div>
      </div>
    </div>

    <section class="detail-section">
      <h2>Your report card</h2>
      ${reviewed.length === 0 ? `<p>No reviews recorded yet — this will fill in as assignments are reviewed.</p>` : `
        <div class="report-card-row">
          ${["green", "yellow", "red"].map((c) => `
            <div class="report-card rc-${c}">
              <div class="report-card-count">${distribution[c]}</div>
              <div class="report-card-label">${REPORT_CARD_META[c].label}</div>
              <div class="report-card-note">${REPORT_CARD_META[c].note}</div>
            </div>
          `).join("")}
        </div>
      `}
    </section>

    ${subjectStats.length ? `<section class="detail-section"><h2>Progress by subject</h2>${renderCategoryBlock("subject", subjectStats)}</section>` : ""}
    ${domainStats.length ? `<section class="detail-section"><h2>Progress by category</h2>${renderCategoryBlock("domain", domainStats)}</section>` : ""}

    <section class="detail-section">
      <h2>Common feedback themes</h2>
      ${themes.length < 1 ? `<p>Not enough reviewer feedback yet to identify themes.</p>` :
        `<div>${themes.map((t) => `<span class="theme-tag">${escapeHTML(t.label)} × ${t.count}</span>`).join("")}</div>`}
    </section>

    ${state.settings.gamification ? renderGamificationSectionHTML() : ""}
  `;

  fetchMissingCategoryBlurbs("subject", subjectStats);
  fetchMissingCategoryBlurbs("domain", domainStats);
}

// Fire-and-forget AI encouragement per category — never blocks the
// initial render, and silently keeps the static fallback line if no
// key is set or the request fails.
async function fetchMissingCategoryBlurbs(fieldKey, statsList) {
  if (!(state.settings.geminiApiKey || "").trim()) return;
  for (const s of statsList) {
    const cacheKey = `${fieldKey}:${s.name}:${s.completed}:${s.total}`;
    if (categoryAICache[cacheKey]) continue;
    const result = await explainProgressWithAI(s.name, s);
    if (result.ok && result.line) {
      categoryAICache[cacheKey] = result.line;
      const el = $(`[data-category-ai="${cacheKey}"]`);
      if (el) el.textContent = result.line;
    }
  }
}

const FEEDBACK_THEME_KEYWORDS = {
  "Research depth": ["research", "depth", "evidence", "sources"],
  "Presentation": ["presentation", "formatting", "layout", "slides", "design"],
  "Citations": ["citation", "cite", "reference", "bibliography"],
  "Clarity": ["clarity", "clear", "confusing", "unclear", "structure"],
  "Testing / edge cases": ["test", "edge case", "coverage", "underflow", "bug"],
};

function extractFeedbackThemes(assignments) {
  const feedbackTexts = assignments.map((a) => a.review.feedback).filter(Boolean);
  if (feedbackTexts.length < 2) return [];

  const combined = feedbackTexts.join(" \n ").toLowerCase();
  const results = [];
  for (const [label, keywords] of Object.entries(FEEDBACK_THEME_KEYWORDS)) {
    const count = keywords.reduce((sum, kw) => sum + (combined.split(kw).length - 1), 0);
    if (count > 0) results.push({ label, count });
  }
  return results.sort((a, b) => b.count - a.count);
}

function renderGamificationSectionHTML() {
  const xp = state.gamification.xp;
  const level = levelFromXP(xp);
  const badges = computeEarnedBadges();
  return `
    <section class="detail-section">
      <h2>Badges</h2>
      <p>Level ${level} · ${titleForLevel(level)} · ${xp} XP</p>
      <div class="badge-row">${badges.map((b) => `<span class="achievement-badge">${b.label}</span>`).join("") || "<span style='color:var(--text-muted)'>No badges yet — keep going!</span>"}</div>
    </section>
  `;
}

// ---- Study Timer view -----------------------------------------------------

function renderTimerView() {
  const container = $("#timer-content");
  const stats = computeStudyStats();
  const fraction = 1 - timerState.remainingSeconds / timerState.totalSeconds;
  const stage = timerTreeStage(fraction);
  const trunkHeight = 14 + stage * 10;
  const leafSize = 30 + stage * 22;

  container.innerHTML = `
    <div class="timer-layout">
      <div class="timer-stage">
        <div class="timer-tree-scene">
          <div class="timer-tree-ground"></div>
          ${stage > 0 ? `<div class="timer-tree-trunk" style="height:${trunkHeight}px;"></div>` : ""}
          ${stage > 0 ? `<div class="timer-tree-leaves" style="width:${leafSize}px; height:${leafSize}px; bottom:${trunkHeight + 6}px;"></div>` : ""}
        </div>
        <div class="timer-stage-label" id="timer-stage-label"></div>
        <div class="timer-clock" id="timer-clock"></div>
        <div class="timer-presets">
          ${TIMER_PRESETS.map((m) => `<button type="button" class="timer-preset-btn ${m === timerState.durationMinutes ? "active" : ""}" data-preset="${m}" ${timerState.running ? "disabled" : ""}>${m} min</button>`).join("")}
        </div>
        <div class="timer-controls">
          ${timerState.running
            ? `<button type="button" class="btn btn-secondary" id="timer-pause-btn">${iconTag("pause", 16)} Pause</button>`
            : `<button type="button" class="btn btn-primary" id="timer-start-btn">${iconTag("play", 16)} Start</button>`}
          <button type="button" class="btn btn-ghost" id="timer-stop-btn">${iconTag("stop", 16)} Reset</button>
        </div>
      </div>
      <div class="timer-stats">
        <div class="timer-stat-row"><span class="timer-stat-value">${stats.totalSessions}</span><span class="timer-stat-label">Sessions completed</span></div>
        <div class="timer-stat-row"><span class="timer-stat-value">${stats.bestDay}</span><span class="timer-stat-label">Best day (sessions)</span></div>
        <h3 style="margin-top:6px;">Recent sessions</h3>
        <ul class="timer-log-list">
          ${stats.sessions.slice(-8).reverse().map((s) => `<li><span>${formatDateShort(s.date)}</span><span>${s.durationMinutes} min</span></li>`).join("") || "<li style='color:var(--text-muted)'>No sessions yet — start one!</li>"}
        </ul>
      </div>
    </div>
  `;
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const clockEl = $("#timer-clock");
  const labelEl = $("#timer-stage-label");
  if (!clockEl) return; // timer view not currently built (safe no-op)
  const m = Math.floor(timerState.remainingSeconds / 60);
  const s = timerState.remainingSeconds % 60;
  clockEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const fraction = 1 - timerState.remainingSeconds / timerState.totalSeconds;
  const stageNames = ["Planting a seed", "Sprouting", "Growing steadily", "Almost there", "Fully grown"];
  if (labelEl) labelEl.textContent = stageNames[timerTreeStage(fraction)];

  // Update the tree visual live without a full re-render.
  const stage = timerTreeStage(fraction);
  const trunk = $(".timer-tree-trunk");
  const leaves = $(".timer-tree-leaves");
  if (trunk) trunk.style.height = `${14 + stage * 10}px`;
  if (leaves) {
    const size = 30 + stage * 22;
    leaves.style.width = `${size}px`;
    leaves.style.height = `${size}px`;
    leaves.style.bottom = `${14 + stage * 10 + 6}px`;
  }
}

// ---- Settings view ---------------------------------------------------------

function getAllUsedSubjects() {
  return Array.from(new Set(state.assignments.map((a) => a.subject).filter(Boolean)));
}
function getAllUsedDomains() {
  return Array.from(new Set(state.assignments.map((a) => a.domain).filter(Boolean)));
}

function populateDomainSuggestions() {
  const domains = Array.from(new Set([...getAllUsedDomains(), ...state.customSubjects])).sort();
  $("#domain-suggestions").innerHTML = domains.map((d) => `<option value="${escapeHTML(d)}">`).join("");
}
function populateSubjectSuggestions() {
  const subjects = Array.from(new Set([...getAllUsedSubjects(), ...state.customSubjects])).sort();
  $("#subject-suggestions").innerHTML = subjects.map((s) => `<option value="${escapeHTML(s)}">`).join("");
}

function renderSettingsView() {
  const container = $("#settings-content");
  const xp = state.gamification.xp;
  const level = levelFromXP(xp);
  const allSubjects = Array.from(new Set([...getAllUsedSubjects(), ...state.customSubjects])).sort();

  container.innerHTML = `
    <div class="settings-group">
      <h3>Profile</h3>
      <div class="form-field">
        <label for="settings-name">Your name</label>
        <input type="text" id="settings-name" maxlength="60" value="${escapeHTML(state.settings.name)}">
      </div>
    </div>

    <div class="settings-group">
      <h3>Gamification</h3>
      <div class="form-field form-field-inline">
        <label for="settings-gamification-toggle">Enable XP, levels and badges</label>
        <input type="checkbox" id="settings-gamification-toggle" ${state.settings.gamification ? "checked" : ""}>
      </div>
      ${state.settings.gamification ? `<p class="settings-hint">Level ${level} · ${titleForLevel(level)} · ${xp} XP</p>` : ""}
    </div>

    <div class="settings-group">
      <h3>Subjects &amp; courses</h3>
      <p class="settings-hint">Add subjects or courses ahead of time so they're ready to pick when you add an assignment.</p>
      <div class="category-manage-list" id="category-manage-list">
        ${allSubjects.map((s) => `
          <span class="category-manage-chip">${escapeHTML(s)}
            <button type="button" data-remove-subject="${escapeHTML(s)}" aria-label="Remove ${escapeHTML(s)}">${iconTag("close", 11)}</button>
          </span>
        `).join("") || "<span style='color:var(--text-muted); font-size:0.85rem;'>No subjects yet.</span>"}
      </div>
      <div class="category-add-row">
        <input type="text" id="settings-new-subject" placeholder="Add a subject or course" maxlength="60">
        <button type="button" class="btn btn-secondary" id="settings-add-subject-btn">${iconTag("plus", 14)} Add</button>
      </div>
    </div>

    <div class="settings-group">
      <h3>Mentor AI (Google Gemini)</h3>
      <p class="settings-hint">
        Your key is stored only in this browser's local storage so the mentor can call Gemini directly from your device.
        <strong>Never paste a production or billing-enabled key into any client-side app</strong> — for a real deployment this call
        must go through a server-side proxy that keeps the key secret. See <code>README.md</code> for details.
      </p>
      <a class="btn btn-secondary" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">${iconTag("sparkle", 14)} Get a free Gemini API key</a>
      <div class="form-field" style="margin-top:12px;">
        <label for="settings-api-key">Gemini API key</label>
        <input type="password" id="settings-api-key" autocomplete="off" placeholder="Paste your Gemini API key" value="${escapeHTML(state.settings.geminiApiKey)}">
      </div>
      <button type="button" id="settings-clear-key-btn" class="btn btn-ghost btn-small">Remove saved key</button>
    </div>

    <div class="settings-group">
      <h3>Data</h3>
      <div class="settings-data-actions">
        <button type="button" id="settings-export-btn" class="btn btn-secondary">Export My Data</button>
        <button type="button" id="settings-clear-btn" class="btn btn-danger">Clear All Data</button>
      </div>
    </div>

    <div class="settings-group">
      <h3>Tutorial</h3>
      <button type="button" id="settings-replay-tutorial-btn" class="btn btn-secondary">Replay the quick tour</button>
    </div>
  `;

  $("#settings-name").addEventListener("change", (e) => { state.settings.name = e.target.value.trim(); saveSettings(); render(); });
  $("#settings-gamification-toggle").addEventListener("change", (e) => {
    state.settings.gamification = e.target.checked;
    saveSettings();
    renderSettingsView();
  });
  $("#settings-api-key").addEventListener("change", (e) => {
    state.settings.geminiApiKey = e.target.value.trim();
    saveSettings();
    showToast("Gemini API key saved to this browser.", "success");
  });
  $("#settings-clear-key-btn").addEventListener("click", () => {
    state.settings.geminiApiKey = "";
    saveSettings();
    renderSettingsView();
    showToast("API key removed.", "info");
  });
  $("#settings-add-subject-btn").addEventListener("click", () => {
    const input = $("#settings-new-subject");
    const value = input.value.trim();
    if (!value) return;
    if (!state.customSubjects.includes(value)) {
      state.customSubjects.push(value);
      saveCustomSubjects();
    }
    input.value = "";
    renderSettingsView();
  });
  $all("[data-remove-subject]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.removeSubject;
      if (state.customSubjects.includes(name)) {
        state.customSubjects = state.customSubjects.filter((s) => s !== name);
        saveCustomSubjects();
        renderSettingsView();
      } else {
        showToast(`"${name}" is used by existing assignments — edit those to change it.`, "info");
      }
    });
  });
  $("#settings-export-btn").addEventListener("click", exportAssignments);
  $("#settings-clear-btn").addEventListener("click", () => {
    showConfirm(
      "Clear all data?",
      "This permanently deletes all your assignments and gamification progress from this browser. Your name and theme preference are kept. This cannot be undone.",
      () => {
        state.assignments = [];
        state.gamification = defaultGamification();
        saveAssignments();
        saveGamification();
        showToast("All assignment data cleared.", "info");
        showView("dashboard");
        render();
      },
      "Clear everything"
    );
  });
  $("#settings-replay-tutorial-btn").addEventListener("click", () => {
    showView("dashboard");
    render();
    setTimeout(startTutorial, 60);
  });
}

function exportAssignments() {
  const blob = new Blob([JSON.stringify(state.assignments, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nexus-assignments-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Custom dropdowns (sort / group by) ---------------------------------

function initCustomSelect(dropdownId, onChange) {
  const dropdown = $(`#${dropdownId}`);
  const trigger = $(`#${dropdownId} .dropdown-trigger`);
  const list = $(`#${dropdownId} .dropdown-list`);

  function close() { dropdown.classList.remove("open"); list.classList.add("hidden"); trigger.setAttribute("aria-expanded", "false"); }
  function open() { dropdown.classList.add("open"); list.classList.remove("hidden"); trigger.setAttribute("aria-expanded", "true"); }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !list.classList.contains("hidden");
    $all(".dropdown-list").forEach((l) => l.classList.add("hidden"));
    $all(".dropdown").forEach((d) => d.classList.remove("open"));
    if (!isOpen) open(); else close();
  });

  $all("li", list).forEach((li) => {
    li.addEventListener("click", () => {
      $all("li", list).forEach((o) => o.setAttribute("aria-selected", "false"));
      li.setAttribute("aria-selected", "true");
      trigger.querySelector("span").textContent = li.textContent;
      close();
      onChange(li.dataset.value);
    });
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

// ---- Onboarding wizard ---------------------------------------------------

function goToWizardStep(stepNumber) {
  $all(".welcome-step").forEach((s) => s.classList.add("hidden"));
  $(`.welcome-step[data-step="${stepNumber}"]`).classList.remove("hidden");
  $all(".welcome-dot").forEach((d, i) => d.classList.toggle("active", i === stepNumber - 1));
}

function finishOnboarding() {
  state.settings.name = $("#welcome-name").value.trim();
  state.settings.theme = $('input[name="theme"]:checked').value;
  state.settings.gamification = $("#welcome-gamification").checked;
  const apiKey = $("#welcome-api-key").value.trim();
  if (apiKey) state.settings.geminiApiKey = apiKey;
  state.settings.onboarded = true;
  saveSettings();
  applyTheme(state.settings.theme);
  completeOnboardingUI();
}

function completeOnboardingUI() {
  $("#welcome-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  render();
  if (!state.settings.tutorialSeen) setTimeout(startTutorial, 300);
}

// ---- Tutorial overlay (coach marks) --------------------------------------

const TUTORIAL_STEPS = [
  { selector: "#search-input", title: "Search everything", text: "Find any assignment by title, subject, or reviewer feedback." },
  { selector: "#groupby-dropdown", title: "Organize your way", text: "Group your dashboard by subject, category, or turn grouping off entirely." },
  { selector: "#next-move-card", title: "Your next move", text: "Nexus figures out what to work on next using deadlines and review status." },
  { selector: "#nav-progress-btn", title: "Track your progress", text: "See completion rates and progress broken down by subject or category." },
  { selector: "#nav-timer-btn", title: "Study Timer", text: "Start a focus session and watch a tree grow as you study." },
  { selector: "#nav-settings-btn", title: "Settings", text: "Manage your API key, subjects, and data anytime from here." },
];
let tutorialIndex = 0;

function startTutorial() {
  tutorialIndex = 0;
  $("#tutorial-overlay").classList.remove("hidden");
  showTutorialStep();
}

function endTutorial() {
  $("#tutorial-overlay").classList.add("hidden");
  state.settings.tutorialSeen = true;
  saveSettings();
}

function showTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialIndex];
  const target = $(step.selector);
  if (!target) { tutorialIndex++; if (tutorialIndex < TUTORIAL_STEPS.length) showTutorialStep(); else endTutorial(); return; }

  const rect = target.getBoundingClientRect();
  const spotlight = $("#tutorial-spotlight");
  spotlight.style.top = `${rect.top - 6}px`;
  spotlight.style.left = `${rect.left - 6}px`;
  spotlight.style.width = `${rect.width + 12}px`;
  spotlight.style.height = `${rect.height + 12}px`;

  const card = $("#tutorial-card");
  let cardTop = rect.bottom + 14;
  if (cardTop + 160 > window.innerHeight) cardTop = Math.max(14, rect.top - 160);
  let cardLeft = Math.min(Math.max(14, rect.left), window.innerWidth - 316);
  card.style.top = `${cardTop}px`;
  card.style.left = `${cardLeft}px`;

  $("#tutorial-step-count").textContent = `(${tutorialIndex + 1}/${TUTORIAL_STEPS.length})`;
  $("#tutorial-title").textContent = step.title;
  $("#tutorial-text").textContent = step.text;
  $("#tutorial-next-btn").textContent = tutorialIndex === TUTORIAL_STEPS.length - 1 ? "Done" : "Next";
}

// ---- Master render ------------------------------------------------------

function renderDashboard() {
  renderGreeting();
  renderLevelWidget();
  renderSummaryCards();
  renderNextMove();
  renderAssignmentList();
}

function render() {
  if (state.currentView === "dashboard") renderDashboard();
  else if (state.currentView === "detail") renderDetailView(getAssignmentById(state.currentAssignmentId));
  else if (state.currentView === "history") renderHistoryView();
  else if (state.currentView === "timer") renderTimerView();
  else if (state.currentView === "settings") renderSettingsView();
  updateCountdowns();
  updateRelativeTimestamps();
}


/* =====================================================================
   9. EVENT HANDLERS
   ===================================================================== */

function openAssignmentModalForCreate() {
  $("#modal-assignment-title").textContent = "Add Assignment";
  $("#assignment-form").reset();
  $("#assignment-id-field").value = "";
  $("#field-status").value = "not-started";
  populateDomainSuggestions();
  populateSubjectSuggestions();
  openModal("modal-assignment");
  $("#field-title").focus();
}

function openAssignmentModalForEdit(assignment) {
  $("#modal-assignment-title").textContent = "Edit Assignment";
  populateDomainSuggestions();
  populateSubjectSuggestions();
  $("#assignment-id-field").value = assignment.id;
  $("#field-title").value = assignment.title;
  $("#field-description").value = assignment.description;
  $("#field-domain").value = assignment.domain || "";
  $("#field-subject").value = assignment.subject;
  $("#field-posted-by").value = assignment.postedBy;
  $("#field-posted-date").value = (assignment.postedDate || "").slice(0, 10);
  $("#field-deadline").value = toLocalDateTimeInputValue(assignment.deadline);
  $("#field-effort").value = assignment.estimatedEffort;
  $("#field-status").value = assignment.status;
  $("#field-notes").value = assignment.notes;
  openModal("modal-assignment");
}

function toLocalDateTimeInputValue(iso) {
  const d = new Date(iso);
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

function handleAssignmentFormSubmit(e) {
  e.preventDefault();
  const id = $("#assignment-id-field").value;
  const title = $("#field-title").value.trim();
  const deadlineLocal = $("#field-deadline").value;

  if (!title || !deadlineLocal) {
    showToast("Please fill in the required fields (title and deadline).", "error");
    return;
  }
  const deadlineISO = new Date(deadlineLocal).toISOString();

  const formValues = {
    title,
    description: $("#field-description").value,
    domain: $("#field-domain").value,
    subject: $("#field-subject").value,
    postedBy: $("#field-posted-by").value,
    postedDate: $("#field-posted-date").value,
    deadline: deadlineISO,
    estimatedEffort: $("#field-effort").value,
    notes: $("#field-notes").value,
    status: $("#field-status").value,
  };

  if (id) {
    const existing = getAssignmentById(id);
    if (existing) {
      const prevStatus = existing.status;
      Object.assign(existing, {
        title: formValues.title,
        description: formValues.description.trim(),
        domain: formValues.domain.trim(),
        subject: formValues.subject.trim(),
        postedBy: formValues.postedBy.trim(),
        postedDate: formValues.postedDate,
        deadline: formValues.deadline,
        estimatedEffort: formValues.estimatedEffort.trim(),
        notes: formValues.notes.trim(),
        status: formValues.status,
      });
      touchAssignment(existing);
      if (formValues.status === "submitted" && prevStatus !== "submitted") addTimelineEvent(existing, "Submitted");
      if (formValues.status === "completed" && prevStatus !== "completed") {
        addTimelineEvent(existing, "Completed");
        awardXP(XP_REWARDS.completeAssignment);
      }
      saveAssignments();
      showToast("Assignment updated ✓", "success");
    }
  } else {
    const assignment = createAssignmentFromForm(formValues);
    state.assignments.push(assignment);
    saveAssignments();
    showToast("Assignment saved ✓ — open it to analyze with Mentor.", "success");
  }

  closeModal("modal-assignment");
  render();
}

function handleReviewFormSubmit(e) {
  e.preventDefault();
  const assignment = getAssignmentById(state.currentAssignmentId);
  if (!assignment) return;

  const cardValue = $('input[name="review-card"]:checked')?.value || "none";
  const feedback = $("#field-review-feedback").value.trim();

  const hadFeedbackBefore = assignment.review.feedback.trim().length > 0;
  assignment.card = cardValue;
  assignment.review.feedback = feedback;
  assignment.review.reviewedDate = feedback ? new Date().toISOString() : assignment.review.reviewedDate;
  touchAssignment(assignment);
  addTimelineEvent(assignment, "Review received", cardValue !== "none" ? `${cardValue} card` : "");
  saveAssignments();

  if (feedback && !hadFeedbackBefore) awardXP(XP_REWARDS.saveReview);

  closeModal("modal-review");
  showToast("Review saved ✓", "success");
  render();
}

async function handleAnalyzeAssignment(id, forceRefresh) {
  const assignment = getAssignmentById(id);
  if (!assignment) return;
  const statusEl = $("#assignment-analysis-status");
  const wasFirstAnalysis = !assignment.aiAnalysis;
  if (statusEl) statusEl.innerHTML = `<div class="loading-inline"><span class="spinner"></span> Mentor is analyzing your assignment…</div>`;

  const result = await analyzeAssignmentWithAI(assignment, forceRefresh);
  if (!result.ok) {
    showToast(result.message, "error");
    if (statusEl) statusEl.innerHTML = "";
    return;
  }
  if (!result.cached) {
    showToast("Analysis complete ✓", "success");
    if (wasFirstAnalysis) awardXP(XP_REWARDS.firstAnalysis);
  } else {
    showToast("Showing cached analysis — nothing changed since last time. Use Re-analyze for a fresh one.", "info");
  }
  render();
}

async function handleAnalyzeReview(id, forceRefresh) {
  const assignment = getAssignmentById(id);
  if (!assignment) return;
  const statusEl = $("#review-analysis-status");
  if (statusEl) statusEl.innerHTML = `<div class="loading-inline"><span class="spinner"></span> Mentor is analyzing the review…</div>`;

  const result = await analyzeReviewWithAI(assignment, forceRefresh);
  if (!result.ok) {
    showToast(result.message, "error");
    if (statusEl) statusEl.innerHTML = "";
    return;
  }
  if (!result.cached) {
    showToast("Analysis complete ✓", "success");
    awardXP(XP_REWARDS.analyzeReview);
  }
  render();
}

async function handleExplainNextMove(id) {
  const pick = pickNextMove(state.assignments);
  if (!pick || pick.assignment.id !== id) return;
  const btn = $("#next-move-ai-btn");
  const quoteEl = $("#next-move-explanation");
  btn.disabled = true;
  quoteEl.textContent = "Mentor is thinking…";

  const result = await explainNextMoveWithAI(pick);
  btn.disabled = false;
  if (!result.ok) {
    showToast(result.message, "error");
    quoteEl.textContent = `"${buildNextMoveExplanation(pick, state.assignments)}"`;
    return;
  }
  quoteEl.textContent = `"${result.explanation}"`;
}

function handleDeleteAssignment(id) {
  const assignment = getAssignmentById(id);
  if (!assignment) return;
  showConfirm(
    "Delete this assignment?",
    `"${assignment.title}" will be permanently removed. This cannot be undone.`,
    () => {
      state.assignments = state.assignments.filter((a) => a.id !== id);
      saveAssignments();
      showToast("Assignment deleted.", "info");
      showView("dashboard");
      render();
    },
    "Delete"
  );
}

function setupEventHandlers() {
  // --- Onboarding wizard ---
  $all("[data-wizard-next]").forEach((btn) => btn.addEventListener("click", () => goToWizardStep(Number(btn.dataset.wizardNext))));
  $all("[data-wizard-back]").forEach((btn) => btn.addEventListener("click", () => goToWizardStep(Number(btn.dataset.wizardBack))));

  $("#welcome-create-assignment-btn").addEventListener("click", () => {
    const title = $("#welcome-assignment-title").value.trim();
    const subject = $("#welcome-assignment-subject").value.trim();
    const deadlineLocal = $("#welcome-assignment-deadline").value;
    if (!title || !subject || !deadlineLocal) {
      showToast("Please fill in the title, subject, and deadline (or skip this step).", "error");
      return;
    }
    const assignment = createAssignmentFromForm({
      title, subject,
      domain: $("#welcome-assignment-domain").value.trim(),
      deadline: new Date(deadlineLocal).toISOString(),
      status: "not-started",
    });
    state.assignments.push(assignment);
    saveAssignments();
    goToWizardStep(3);
  });
  $("#welcome-skip-assignment-btn").addEventListener("click", () => goToWizardStep(3));
  $("#welcome-finish-btn").addEventListener("click", finishOnboarding);
  $("#welcome-skip-key-btn").addEventListener("click", finishOnboarding);

  // --- Tutorial ---
  $("#tutorial-next-btn").addEventListener("click", () => {
    tutorialIndex++;
    if (tutorialIndex >= TUTORIAL_STEPS.length) endTutorial();
    else showTutorialStep();
  });
  $("#tutorial-skip-btn").addEventListener("click", endTutorial);

  // --- Sidebar navigation ---
  $all(".sidebar-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => { showView(btn.dataset.view); render(); });
  });

  // --- Header ---
  $("#theme-toggle-btn").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    saveSettings();
    applyTheme(state.settings.theme);
  });
  $("#back-to-dashboard-btn").addEventListener("click", () => { showView("dashboard"); render(); });

  let searchDebounce;
  $("#search-input").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const value = e.target.value;
    searchDebounce = setTimeout(() => { state.searchQuery = value; renderAssignmentList(); updateCountdowns(); }, 120);
  });

  // --- Filters ---
  $("#filter-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tab");
    if (!btn) return;
    $all(".filter-tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    state.currentFilter = btn.dataset.filter;
    renderAssignmentList();
    updateCountdowns();
  });

  // --- Custom dropdowns: sort + group by ---
  initCustomSelect("sort-dropdown", (value) => {
    state.currentSort = value;
    renderAssignmentList();
    updateCountdowns();
  });
  initCustomSelect("groupby-dropdown", (value) => {
    state.currentGroupBy = value;
    renderAssignmentList();
    updateCountdowns();
  });

  // --- Add assignment ---
  $("#add-assignment-btn").addEventListener("click", openAssignmentModalForCreate);
  $("#empty-add-btn").addEventListener("click", openAssignmentModalForCreate);
  $("#assignment-form").addEventListener("submit", handleAssignmentFormSubmit);
  $("#review-form").addEventListener("submit", handleReviewFormSubmit);

  // --- Generic modal close (X button, backdrop click, Escape) ---
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-close-modal]") || e.target.closest("[data-close-modal]")) {
      const closeBtn = e.target.matches("[data-close-modal]") ? e.target : e.target.closest("[data-close-modal]");
      closeModal(closeBtn.dataset.closeModal);
    }
    if (e.target.classList.contains("modal-overlay")) closeModal(e.target.id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });

  // --- Confirm modal ---
  $("#modal-confirm-action-btn").addEventListener("click", () => {
    const action = state.pendingConfirmAction;
    state.pendingConfirmAction = null;
    closeModal("modal-confirm");
    if (action) action();
  });

  // --- Delegated actions across dashboard/detail views ---
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case "open-assignment":
        state.currentAssignmentId = id;
        showView("detail");
        render();
        break;
      case "edit-assignment":
        openAssignmentModalForEdit(getAssignmentById(id));
        break;
      case "delete-assignment":
        handleDeleteAssignment(id);
        break;
      case "analyze-assignment":
        handleAnalyzeAssignment(id, !!getAssignmentById(id)?.aiAnalysis);
        break;
      case "analyze-review":
        handleAnalyzeReview(id, !!getAssignmentById(id)?.review?.analysis);
        break;
      case "open-review-modal": {
        const assignment = getAssignmentById(id);
        state.currentAssignmentId = id;
        $(`input[name="review-card"][value="${assignment.card}"]`).checked = true;
        $("#field-review-feedback").value = assignment.review.feedback;
        openModal("modal-review");
        break;
      }
      case "explain-next-move":
        handleExplainNextMove(id);
        break;
    }
  });

  // Status change inside detail view (delegated, since the select is re-rendered)
  document.addEventListener("change", (e) => {
    if (e.target.id === "detail-status-select") {
      const assignment = getAssignmentById(e.target.dataset.id);
      const prevStatus = assignment.status;
      assignment.status = e.target.value;
      touchAssignment(assignment);
      if (assignment.status === "submitted" && prevStatus !== "submitted") addTimelineEvent(assignment, "Submitted");
      if (assignment.status === "completed" && prevStatus !== "completed") {
        addTimelineEvent(assignment, "Completed");
        awardXP(XP_REWARDS.completeAssignment);
      }
      saveAssignments();
      showToast("Status updated ✓", "success");
      render();
    }
  });

  // --- Study timer controls (delegated, since the view is rebuilt each visit) ---
  document.addEventListener("click", (e) => {
    if (e.target.closest("#timer-start-btn")) startStudyTimer();
    else if (e.target.closest("#timer-pause-btn")) pauseStudyTimer();
    else if (e.target.closest("#timer-stop-btn")) stopStudyTimer();
    else if (e.target.closest("[data-preset]")) startStudyTimer(Number(e.target.closest("[data-preset]").dataset.preset));
  });
}


/* =====================================================================
   10. INITIALIZATION
   ===================================================================== */

function init() {
  state.assignments = loadAssignments();
  state.settings = loadSettings();
  state.gamification = loadGamification();
  state.customSubjects = loadCustomSubjects();

  applyTheme(state.settings.theme);
  setupEventHandlers();

  if (state.settings.onboarded) {
    $("#app").classList.remove("hidden");
    if (!state.settings.tutorialSeen) setTimeout(startTutorial, 400);
  } else {
    $("#welcome-screen").classList.remove("hidden");
  }

  render();
  startTimeLoops();
}

document.addEventListener("DOMContentLoaded", init);
