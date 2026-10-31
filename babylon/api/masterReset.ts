// BarrioMU: los Master Reset de cada personaje. OpenMU los guarda en
// ~/openmu/data/master-reset.json (BarrioMasterResetPlugIn.cs, por id de
// personaje); aqui se leen para el ranking y el panel, y el panel tambien los
// escribe. Los dos lados cambian el archivo con el mismo candado
// (master-reset.json.lock) y lo reemplazan de una vez (archivo temporal + rename).

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Igual que BarrioMasterResetPlugIn.RequiredResets y BonusPointsPerMasterReset. */
export const REQUIRED_RESETS = 50;
export const BONUS_POINTS = 10_000;

const FILE = process.env.MASTER_RESET_FILE ?? `${process.env.HOME ?? "/root"}/openmu/data/master-reset.json`;
const LOCK = FILE + ".lock";
const STALE_LOCK_MS = 10_000;

/** Id de personaje (minusculas) -> Master Resets. */
export function readMasterResets(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    if (!existsSync(FILE)) return out;
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    for (const [id, n] of Object.entries(parsed ?? {})) {
      if (typeof n === "number" && Number.isInteger(n) && n > 0) out.set(id.toLowerCase(), n);
    }
  } catch {
    // Un archivo roto se lee como vacio, igual que en OpenMU.
  }
  return out;
}

export function masterResetsOf(characterId: string): number {
  return readMasterResets().get(characterId.toLowerCase()) ?? 0;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Pone los Master Reset de un personaje. Lanza un error si no pudo escribir. */
export async function setMasterResets(characterId: string, value: number): Promise<void> {
  mkdirSync(dirname(FILE), { recursive: true });
  let fd: number | null = null;
  for (let attempt = 0; attempt < 50 && fd === null; attempt++) {
    try {
      fd = openSync(LOCK, "wx");
    } catch {
      try {
        // Un candado que dejo un proceso que murio.
        if (Date.now() - statSync(LOCK).mtimeMs > STALE_LOCK_MS) {
          unlinkSync(LOCK);
          continue;
        }
      } catch {
        continue;
      }
      await sleep(100);
    }
  }
  if (fd === null) throw new Error("master-reset: no se pudo tomar el candado");

  try {
    let all: Record<string, number> = {};
    try {
      if (existsSync(FILE)) all = JSON.parse(readFileSync(FILE, "utf8")) ?? {};
    } catch {
      all = {};
    }
    // OpenMU escribe los ids en minusculas (Guid.ToString()); una sola clave por personaje.
    for (const key of Object.keys(all)) if (key.toLowerCase() === characterId.toLowerCase()) delete all[key];
    all[characterId.toLowerCase()] = value;
    const temp = FILE + ".tmp";
    writeFileSync(temp, JSON.stringify(all));
    renameSync(temp, FILE);
  } finally {
    closeSync(fd);
    try {
      unlinkSync(LOCK);
    } catch {
      // ya no estaba
    }
  }
}
