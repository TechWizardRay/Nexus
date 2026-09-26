# Nexus

**Understand. Prioritize. Improve. Progress.**

Nexus is a persistent, AI-assisted academic assignment mentor. It helps a student store
assignments, understand what each one actually requires, track review results
(🟢/🟡/🔴), get an AI-generated improvement plan, and always know what to work on next.

Built as a pure **HTML5 + CSS3 + vanilla JavaScript** web app — no frameworks, no build
step, no backend. Open `index.html` and it runs.

## Running it

Just open `index.html` in a browser. For the best experience (and to avoid any
browser quirks around `file://` pages), serve it locally instead:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Files

```
index.html   — markup for every screen (dashboard, detail, progress, timer, settings, onboarding)
style.css    — both themes (dark "Arcade Purple" / light "Plan-Arcadia") + layout
script.js    — all application logic, organized into commented sections
assets/      — favicon
```

## First run

The first time you open Nexus, a short wizard asks for your name and theme, walks you
through adding one real assignment of your own (no canned demo data), and offers an
optional Gemini API key step. A quick interactive tour then points out search,
grouping, Progress, Study Timer, and Settings — replay it anytime from
**Settings → Replay the quick tour**.

Assignments are organized however you use them: by **Subject/course**, by a broader
**Category**, or not grouped at all — switch anytime from the dashboard toolbar. Add new
subjects ahead of time from **Settings → Subjects & courses**, or just type a new one
into the assignment form.

## Setting up the AI mentor (Google Gemini)

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) —
   linked directly from the onboarding wizard and from Settings.
2. Paste it into **Settings → Gemini API key** (or during onboarding).
3. Open any assignment and click **Analyze with Mentor**.

### ⚠️ Security note (read this before deploying anywhere public)

This is a **frontend-only student assignment**, so the Gemini API key is stored in
`localStorage` and the browser calls Google's API directly. That is fine for local use
and grading, but it is **not a safe pattern for a real, public deployment** — anyone who
opens the browser's dev tools can read the key out of `localStorage` and the network
tab.

If this app were shipped for real users, the fix would be to add a minimal server-side
proxy: the browser calls *your* server, your server (which holds the key in an
environment variable, never in client code) calls Gemini, and the key never reaches the
browser. That backend is intentionally **not** part of this assignment's implementation
— the brief asks for the primary version to remain HTML + CSS + vanilla JS — but the
Gemini calls are isolated in one section of `script.js` (`GEMINI API`) so a proxy could
be dropped in later by changing only `geminiEndpoint()` / `callGeminiJSON()`.

## Data & privacy

Everything (assignments, reviews, AI results, preferences) lives in `localStorage` in
your own browser — nothing is sent anywhere except the specific assignment text or
review feedback needed for the Gemini call you trigger. Clearing your browser data or
using "Clear All Data" in Settings removes it for good.

## Study Timer

A separate section (sidebar → **Study Timer**) for focused study sessions: pick a
15/25/45/60-minute preset and a tree grows through visible stages as you focus. Only
fully-completed sessions are logged — Settings has no bearing here, it's always on.
Your session count and best day (most sessions completed in a single day) are tracked
under **Progress**.
