#!/usr/bin/env node
/**
 * Build script for Met Tracker — AI Engineer World's Fair 2026
 * Fetches speakers.json + sessions.json, enriches seed roster,
 * optionally adds speakers from target tracks, and emits dist/index.html.
 */
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://www.ai.engineer/worldsfair/2026";
const PHOTO_BASE = "https://www.ai.engineer";

// ---------- Target tracks to scan for additional speakers ----------
const TARGET_TRACKS = [
  "AI-Native Enterprises",
  "Agentic Engineering",
  "Sandbox & Platform Engineering",
  "Context Engineering",
  "Evals",
  "Security",
];

// ---------- Seed roster from Jeremy's reference (IDs to match/enrich) ----------
const SEED_IDS = new Set([
  "swyx", "addy", "huda", "nassr", "bhardwaj", "azzam", "adi", "simonw", "karpathy", "srush",
]);

// Manual seed entries for people unlikely to be in the speakers API
const MANUAL_SEEDS = [
  {
    id: "simonw", name: "Simon Willison", role: "Independent, co-creator of Django",
    tier: "recognize", tags: ["Builder celeb", "Security"],
    why: "THE builder-celeb for this crowd — coined 'prompt injection,' the 'lethal trifecta,' and the pelican-on-a-bicycle benchmark.",
    session: null,
    links: { x: "https://x.com/simonw", site: "https://simonwillison.net" },
    photoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Simon_Willison_%282929211382%29_%28cropped%29.jpg/250px-Simon_Willison_%282929211382%29_%28cropped%29.jpg",
  },
  {
    id: "karpathy", name: "Andrej Karpathy", role: "Independent, ex-OpenAI, Tesla",
    tier: "recognize", tags: ["Patron saint", "Unconfirmed"],
    why: "Coined 'vibe coding' and the LLM-OS framing. Recognize on sight; attendance unconfirmed.",
    session: null,
    links: { x: "https://x.com/karpathy" },
    photoUrl: "https://karpathy.ai/assets/me_new.jpg",
  },
  {
    id: "srush", name: "Sasha Rush", role: "Cursor, researcher",
    tier: "recognize", tags: ["Cursor Composer", "Unconfirmed"],
    why: "Known for the technical journey behind Cursor Composer. Rotates through these stages; attendance unconfirmed.",
    session: null,
    links: { x: "https://x.com/srush_nlp" },
    photoUrl: "https://simons.berkeley.edu/sites/default/files/styles/post_card_lg_2x/public/profiles/35882%2520%25283%2529_5.jpeg.jpg?h=c35ab9d9&itok=T84HV2uv",
  },
  {
    id: "nassr", name: "Matt Nassr", role: "Head of Global Data Eng & AI Transformation, Optiver",
    tier: "confirmed", tags: ["Agentic SDLC", "Governance"],
    why: "Hosts the Agentic SDLC Loop session on shared foundations: context, evaluation, execution, governance. The governance angle maps to your CNA Stewards / procurement concerns.",
    session: "Day 2 · Tue · 7:30 PM · side event (Optiver)",
    links: {},
    photoUrl: "https://cdn.theorg.com/d97edf34-ecb8-40e3-90b5-2771017c06f2_medium.jpg",
  },
];

function makeId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
}

function findSeedId(name) {
  const lower = name.toLowerCase();
  // Match known seed IDs by last name or known alias
  const map = {
    "shawn wang": "swyx", "swyx": "swyx",
    "addy osmani": "addy",
    "adam huda": "huda",
    "matt nassr": "nassr",
    "abhishek bhardwaj": "bhardwaj",
    "adam azzam": "azzam",
    "adi singh": "adi",
    "simon willison": "simonw",
    "andrej karpathy": "karpathy",
    "sasha rush": "srush",
  };
  return map[lower] || null;
}

// Map of seed IDs to custom "why" text from Jeremy's reference
const SEED_WHY = {
  swyx: "Runs the whole conference and coined 'the AI Engineer.' If you meet one name, it's him. Easy to find on the main stage between keynotes.",
  addy: "14+ years leading dev experience at Google. A genuine celebrity in the web-dev-to-AI pipeline.",
  huda: "His talk is almost a mirror of your APEX thesis — 70% of Uber PRs AI-attributed, 15% fully autonomous. Highest-value hallway conversation on the list.",
  nassr: "Hosts the Agentic SDLC Loop session on shared foundations: context, evaluation, execution, governance. The governance angle maps to your CNA Stewards / procurement concerns.",
  bhardwaj: "'From fork() to Fleet' — isolation, persistence, and scaling agent sandboxes. Relevant to your GKE multi-agent OpenClaw setup. Built Arrakis (open-source agent sandbox).",
  azzam: "'Don't build agents, build environments.' The reproducible-environment problem you live in day to day.",
  adi: "His talk literally references openclaw — building the identity layer for non-human agents. Worth finding given your own OpenClaw work.",
};

const SEED_TAGS = {
  swyx: ["Host", "Main Stage", "Latent Space"],
  addy: ["Closing Keynote", "Dev Tools"],
  huda: ["Agentic SDLC", "Software Factory", "Uber"],
  nassr: ["Agentic SDLC", "Governance"],
  bhardwaj: ["Sandboxes", "Agent Infra", "OpenAI"],
  azzam: ["Environments", "Infra"],
  adi: ["Agent Identity", "YC S25", "OpenClaw"],
};

async function fetchJSON(url) {
  console.log(`Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function formatSession(s) {
  if (!s) return null;
  const parts = [];
  if (s.day) parts.push(s.day.replace(/—.*/, "").trim());
  if (s.time) parts.push(s.time);
  if (s.room) parts.push(s.room);
  if (s.type === "keynote") parts.push("(keynote)");
  return parts.join(" · ");
}

function resolvePhoto(photoUrl) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("http")) return photoUrl;
  return PHOTO_BASE + photoUrl;
}

async function main() {
  const [speakersData, sessionsData] = await Promise.all([
    fetchJSON(`${BASE}/speakers.json`),
    fetchJSON(`${BASE}/sessions.json`),
  ]);

  const speakers = speakersData.speakers || [];
  const sessions = sessionsData.sessions || [];

  // Fallback photos for speakers missing photoUrl in the API
  const FALLBACK_PHOTOS = {
    "steve yegge": "https://yegge.ai/photo-web.jpg",
    "manoj nair": "https://res.cloudinary.com/snyk/image/upload/v1681914119/headshot-manoj-snyk.jpg",
  };

  // Build speaker lookup by lowercase name
  const speakerMap = new Map();
  for (const s of speakers) {
    speakerMap.set(s.name.toLowerCase(), s);
  }

  // Track which speakers we've added
  const addedIds = new Set();
  const roster = [];

  // 1. Process seed speakers — match against API data
  for (const spk of speakers) {
    const seedId = findSeedId(spk.name);
    if (!seedId) continue;

    const primarySession = spk.sessions?.[0];
    const entry = {
      id: seedId,
      name: spk.name,
      role: [spk.role, spk.company].filter(Boolean).join(" · "),
      tier: "confirmed",
      tags: SEED_TAGS[seedId] || [primarySession?.track].filter(Boolean),
      why: SEED_WHY[seedId] || spk.bio?.slice(0, 150) || "",
      session: formatSession(primarySession),
      sessionTitle: primarySession?.title || null,
      links: {
        ...(spk.twitter ? { x: spk.twitter } : {}),
        ...(spk.linkedin ? { linkedin: spk.linkedin } : {}),
        ...(spk.website ? { site: spk.website } : {}),
      },
      photoUrl: resolvePhoto(spk.photoUrl),
    };
    roster.push(entry);
    addedIds.add(seedId);
  }

  // 2. Add manual seeds not found in API (recognize-tier)
  for (const m of MANUAL_SEEDS) {
    if (addedIds.has(m.id)) continue;
    // Check if they happen to be in the API after all
    const apiMatch = speakerMap.get(m.name.toLowerCase());
    if (apiMatch) {
      const primarySession = apiMatch.sessions?.[0];
      roster.push({
        ...m,
        tier: "confirmed",
        role: [apiMatch.role, apiMatch.company].filter(Boolean).join(" · ") || m.role,
        session: formatSession(primarySession),
        sessionTitle: primarySession?.title || null,
        photoUrl: resolvePhoto(apiMatch.photoUrl),
        links: {
          ...(apiMatch.twitter ? { x: apiMatch.twitter } : {}),
          ...(apiMatch.linkedin ? { linkedin: apiMatch.linkedin } : {}),
          ...(apiMatch.website ? { site: apiMatch.website } : {}),
          ...m.links,
        },
      });
    } else {
      roster.push({ ...m, sessionTitle: null });
    }
    addedIds.add(m.id);
  }

  // Also add nassr / swyx if not matched above (swyx might be listed differently)
  // Handle swyx specially since the API might list him as "Shawn Wang" without "swyx"
  if (!addedIds.has("swyx")) {
    // Search for anyone whose bio/name mentions "swyx" or "latent space"
    for (const spk of speakers) {
      if (spk.name.toLowerCase().includes("swyx") || spk.name.toLowerCase().includes("shawn wang") ||
          (spk.bio && spk.bio.toLowerCase().includes("latent space"))) {
        const primarySession = spk.sessions?.[0];
        roster.push({
          id: "swyx",
          name: `swyx (${spk.name})`,
          role: [spk.role, spk.company].filter(Boolean).join(" · ") || "Founder & host, AI Engineer",
          tier: "confirmed",
          tags: SEED_TAGS.swyx,
          why: SEED_WHY.swyx,
          session: formatSession(primarySession),
          sessionTitle: primarySession?.title || null,
          links: {
            ...(spk.twitter ? { x: spk.twitter } : {}),
            ...(spk.linkedin ? { linkedin: spk.linkedin } : {}),
            ...(spk.website ? { site: spk.website } : {}),
          },
          photoUrl: resolvePhoto(spk.photoUrl),
        });
        addedIds.add("swyx");
        break;
      }
    }
  }

  // 3. Scan target tracks for additional interesting speakers (up to ~20 total)
  const MAX_TOTAL = 30;
  const trackSpeakers = new Map(); // name -> session
  for (const sess of sessions) {
    const track = sess.track || "";
    const matchesTrack = TARGET_TRACKS.some(t => track.toLowerCase().includes(t.toLowerCase()));
    if (!matchesTrack) continue;
    if (sess.status !== "confirmed") continue;
    for (const name of (sess.speakers || [])) {
      if (!trackSpeakers.has(name.toLowerCase())) {
        trackSpeakers.set(name.toLowerCase(), sess);
      }
    }
  }

  for (const [nameLower, sess] of trackSpeakers) {
    if (roster.length >= MAX_TOTAL) break;
    const spk = speakerMap.get(nameLower);
    if (!spk) continue;
    const id = makeId(spk.name);
    if (addedIds.has(id) || addedIds.has(findSeedId(spk.name))) continue;

    roster.push({
      id,
      name: spk.name,
      role: [spk.role, spk.company].filter(Boolean).join(" · "),
      tier: "confirmed",
      tags: [sess.track].filter(Boolean),
      why: sess.title || "",
      session: formatSession(sess),
      sessionTitle: sess.title || null,
      links: {
        ...(spk.twitter ? { x: spk.twitter } : {}),
        ...(spk.linkedin ? { linkedin: spk.linkedin } : {}),
        ...(spk.website ? { site: spk.website } : {}),
      },
      photoUrl: resolvePhoto(spk.photoUrl) || FALLBACK_PHOTOS[nameLower] || null,
    });
    addedIds.add(id);
  }

  console.log(`Roster: ${roster.length} people (${roster.filter(r => r.tier === "confirmed").length} confirmed, ${roster.filter(r => r.tier === "recognize").length} recognize)`);

  // 4. Generate the HTML
  const template = readFileSync(join(__dirname, "template.html"), "utf8");
  const html = template.replace("__ROSTER_JSON__", JSON.stringify(roster, null, 2));

  mkdirSync(join(__dirname, "dist"), { recursive: true });
  writeFileSync(join(__dirname, "dist/index.html"), html);
  console.log("Wrote dist/index.html");
}

main().catch(e => { console.error(e); process.exit(1); });
