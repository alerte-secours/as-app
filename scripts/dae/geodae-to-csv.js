#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHoraires } from "./lib/normalize-horaires.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const INPUT = join(__dirname, "geodae.json");
const OUTPUT = join(__dirname, "geodae.csv");

// --- Helpers ---

function escapeCsv(value) {
  if (value == null) return "";
  // Replace newlines with spaces to keep one row per entry
  const str = String(value).replace(/[\r\n]+/g, " ").trim();
  if (str.includes('"') || str.includes(",")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

const DAY_ABBREV = {
  lundi: "Lun",
  mardi: "Mar",
  mercredi: "Mer",
  jeudi: "Jeu",
  vendredi: "Ven",
  samedi: "Sam",
  dimanche: "Dim",
};
const DAY_ORDER = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];

const DAY_NAMES_PATTERN =
  /lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i;
const DAY_NAMES_EN_PATTERN =
  /\b(mon|tue|wed|thu|fri|sat|sun)\b|mo-|tu-|we-|th-|fr-|sa-|su-/i;
const HOUR_PATTERN = /\d+[h:]\d*|\d+ ?heures?\b/;

function formatDays(arr) {
  if (!arr || arr.length === 0) return "";
  if (arr.length === 1) {
    const val = arr[0].toLowerCase().trim();
    if (val === "7j/7") return "7j/7";
    if (val === "non renseigné" || val === "non renseigne") return "";
    if (DAY_ABBREV[val]) return DAY_ABBREV[val];
    return arr[0].trim();
  }

  // Sort days by canonical order
  const sorted = arr
    .filter((d) => d != null)
    .map((d) => d.toLowerCase().trim())
    .filter((d) => DAY_ORDER.includes(d))
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

  if (sorted.length === 0) return arr.filter((d) => d != null).join(", ");
  if (sorted.length === 7) return "7j/7";

  // Detect consecutive range
  const indices = sorted.map((d) => DAY_ORDER.indexOf(d));
  const isConsecutive = indices.every(
    (idx, i) => i === 0 || idx === indices[i - 1] + 1
  );

  if (isConsecutive && sorted.length >= 2) {
    return (
      DAY_ABBREV[sorted[0]] + "-" + DAY_ABBREV[sorted[sorted.length - 1]]
    );
  }

  return sorted.map((d) => DAY_ABBREV[d] || d).join(", ");
}

function formatHours(arr) {
  if (!arr || arr.length === 0) return "";
  const cleaned = arr
    .filter((h) => h != null)
    .map((h) => h.trim())
    .filter(
      (h) =>
        h &&
        h.toLowerCase() !== "non renseigné" &&
        h.toLowerCase() !== "non renseigne"
    );
  return cleaned.join(" + ");
}

/**
 * Determine if always available:
 * - 7j/7 + 24h/24
 * - OR public (Extérieur + libre access)
 */
function isAlwaysAvailable(p) {
  const is247 = is7j7(p.c_disp_j) && is24h(p.c_disp_h);

  const isExterior =
    p.c_acc &&
    (p.c_acc.trim().toLowerCase() === "extérieur" ||
      p.c_acc.trim().toLowerCase() === "exterieur");
  const isPublic = isExterior && p.c_acc_lib === true;

  return is247 || isPublic;
}

function is7j7(arr) {
  if (!arr) return false;
  if (arr.some((d) => d && d.trim() === "7j/7")) return true;
  const days = arr
    .filter((d) => d != null)
    .map((d) => d.toLowerCase().trim())
    .filter((d) => DAY_ORDER.includes(d));
  return days.length === 7;
}

function is24h(arr) {
  if (!arr) return false;
  return arr.some((h) => h && h.trim() === "24h/24");
}

/**
 * Build a single horaires string, merging days/hours/complement smartly.
 * Returns empty string if always available.
 *
 * Heuristic for complement deduplication:
 * - If complement contains day names → it already describes the full schedule → use complement only
 * - Else if complement contains hour patterns (refines "heures ouvrables") → use days + complement
 * - Else → use days + hours + complement (it's purely additional info)
 */
function buildHoraires(p) {
  const days = formatDays(p.c_disp_j);
  const hours = formatHours(p.c_disp_h);
  const complt = (p.c_disp_complt || "").replace(/[\r\n]+/g, " ").trim();

  if (!complt) {
    // No complement: just days + hours
    if (days && hours) return days + " " + hours;
    return days || hours || "";
  }

  // Has complement: decide how to merge
  const hasDayNames =
    DAY_NAMES_PATTERN.test(complt) || DAY_NAMES_EN_PATTERN.test(complt);
  const hasHours = HOUR_PATTERN.test(complt);

  if (hasDayNames && hasHours) {
    // Complement is a detailed per-day schedule (e.g. "Lundi au jeudi : 8h30-18h ...")
    // Use complement only — it's more specific than the base timetable
    return complt;
  }

  if (hasHours) {
    // Complement specifies actual hours (e.g. "8h-18h")
    // It refines the vague "heures ouvrables" → use days + complement
    if (days) return days + " " + complt;
    return complt;
  }

  // Complement is purely additional info (e.g. "Ouvert le dimanche...", "fermeture 31/12")
  const base = days && hours ? days + " " + hours : days || hours || "";
  if (base) return base + " ; " + complt;
  return complt;
}

function formatAddress(p) {
  const parts = [];
  const num = (p.c_adr_num || "").trim();
  const street = (p.c_adr_voie || "").trim();
  if (num && street) {
    parts.push(num + " " + street);
  } else if (street) {
    parts.push(street);
  }
  const cp = (p.c_com_cp || "").trim();
  const city = (p.c_com_nom || "").trim();
  if (cp && city) {
    parts.push(cp + " " + city);
  } else if (city) {
    parts.push(city);
  }
  return parts.join(", ");
}

function formatAccess(p) {
  const parts = [];

  // Indoor/Outdoor
  if (p.c_acc) parts.push(p.c_acc.trim());

  // Free access
  if (p.c_acc_lib === true) parts.push("libre");

  // Floor
  const floor = (p.c_acc_etg || "").trim().toLowerCase();
  if (
    floor &&
    floor !== "0" &&
    floor !== "rdc" &&
    floor !== "rez de chaussee" &&
    floor !== "rez de chaussée"
  ) {
    parts.push("étage " + p.c_acc_etg.trim());
  }

  // Complement
  const complt = (p.c_acc_complt || "").trim();
  if (complt) parts.push(complt);

  return parts.join(", ");
}

function getName(p) {
  const expt = (p.c_expt_rais || "").trim();
  const nom = (p.c_nom || "").trim();
  return expt || nom || "";
}

function normalize(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function passesFilter(p) {
  // c_etat: accept "Actif" or null, reject "Non identifie"
  const etat = normalize(p.c_etat);
  if (etat && etat !== "actif") return false;

  // c_etat_fonct: must be "En fonctionnement"
  const fonct = normalize(p.c_etat_fonct);
  if (fonct !== "en fonctionnement") return false;

  // c_etat_valid: must be "validées"
  const valid = normalize(p.c_etat_valid);
  if (valid !== "validees") return false;

  return true;
}

// --- Main ---

console.log("Reading geodae.json...");
const data = JSON.parse(readFileSync(INPUT, "utf-8"));
const features = data.features;
console.log(`Total features: ${features.length}`);

const CSV_HEADER = [
  "latitude",
  "longitude",
  "nom",
  "adresse",
  "horaires",
  "horaires_std",
  "acces",
  "disponible_24h",
];

const rows = [CSV_HEADER.join(",")];
let filtered = 0;
let kept = 0;
let alwaysCount = 0;

for (const feature of features) {
  const p = feature.properties;

  if (!passesFilter(p)) {
    filtered++;
    continue;
  }

  const lat = p.c_lat_coor1;
  const lon = p.c_long_coor1;
  if (lat == null || lon == null) {
    filtered++;
    continue;
  }

  const always = isAlwaysAvailable(p);
  if (always) alwaysCount++;

  const disponible24h = always ? 1 : 0;

  // When always available, leave horaires empty
  const horaires = always ? "" : buildHoraires(p);

  // Normalize horaires into structured JSON
  const horairesStd = normalizeHoraires(horaires, disponible24h);

  const row = [
    lat,
    lon,
    escapeCsv(getName(p)),
    escapeCsv(formatAddress(p)),
    escapeCsv(horaires),
    escapeCsv(JSON.stringify(horairesStd)),
    escapeCsv(formatAccess(p)),
    disponible24h,
  ];

  rows.push(row.join(","));
  kept++;
}

writeFileSync(OUTPUT, rows.join("\n") + "\n", "utf-8");
console.log(`Kept: ${kept}, Filtered out: ${filtered}`);
console.log(`Always available (24h): ${alwaysCount}`);
console.log(`Written to ${OUTPUT}`);
