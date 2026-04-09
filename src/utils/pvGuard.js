// ============================================================
// pvGuard.js — Guarda de PV (Mensagens Privadas)
//
// Verifica se um usuário tem autorização para interagir no PV.
// Usuários autorizados: ROOT + qualquer ID presente no allowed.json
// (como pagador ou autorizado em qualquer grupo, ou em privados).
//
// IMPORTANTE: Este módulo NÃO afeta envios proativos do bot
// (relatórios de leilão, alertas de ban, etc.), apenas mensagens
// recebidas de usuários no PV.
// ============================================================

import fs from "fs";
import path from "path";
import { idsMatch } from "./userMapper.js";

const AUTH_PATH = path.resolve("src/data/auth/allowed.json");

// ROOT_ID Hardcoded (mesmo do userMapper.js)
const ROOT_HARDCODED = ["65060886032554", "554792671477"];

/**
 * Normaliza um ID para apenas dígitos (máximo 15).
 */
function normalizarId(raw) {
  if (!raw) return "";
  return raw.replace(/\D/g, "").slice(-15);
}

/**
 * Carrega o allowed.json.
 */
function loadAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  } catch (e) {
    return { grupos: {}, privados: {} };
  }
}

/**
 * Verifica se um usuário está autorizado a usar o PV do bot.
 * 
 * Retorna true se:
 * - É ROOT (hardcoded ou via .env)
 * - Está em allowed.json como pagador ou autorizado em qualquer grupo
 * - Está em allowed.json na seção privados
 * 
 * @param {string} fromClean - ID normalizado do remetente
 * @returns {boolean}
 */
export function isAllowedPV(fromClean) {
  const normalizado = normalizarId(fromClean);

  // 1. Verificar ROOT hardcoded
  if (ROOT_HARDCODED.includes(normalizado)) return true;

  // 2. Verificar ROOT via .env
  const ROOT = process.env.ROOT_ID;
  if (ROOT && idsMatch(normalizado, ROOT)) return true;

  const db = loadAuth();

  // 3. Verificar em privados
  if (db.privados) {
    for (const privId of Object.keys(db.privados)) {
      if (idsMatch(normalizado, privId)) return true;
    }
  }

  // 4. Verificar em qualquer grupo (como autorizado ou pagador)
  for (const grupoId of Object.keys(db.grupos || {})) {
    const grupo = db.grupos[grupoId];

    // Verificar pagador
    if (grupo.pagador && idsMatch(normalizado, grupo.pagador)) return true;

    // Verificar lista de autorizados
    if (grupo.autorizados) {
      for (const autId of grupo.autorizados) {
        if (idsMatch(normalizado, autId)) return true;
      }
    }
  }

  return false;
}

// ============================================================
// FIM pvGuard.js
// ============================================================
