// ============================================================
// userMapper.js — Mapeamento de IDs do WhatsApp (LID ↔ PN)
//
// O WhatsApp usa dois tipos de IDs para o mesmo usuário:
// 1. LID (ex: 65060886032554) — Usado em grupos e enquetes
// 2. PN (ex: 554792671477) — Usado no PV (Private Message)
//
// Este módulo mantém um mapeamento persistente para que o bot
// reconheça o mesmo usuário em ambos os contextos.
// ============================================================

import fs from "fs";
import path from "path";

const MAP_PATH = path.resolve("src/data/mapeamento_usuarios.json");

// ROOT_ID Hardcoded para garantir acesso total ao Fernando
const ROOT_HARDCODED = ["65060886032554", "554792671477"];

/**
 * Carrega o mapeamento do arquivo JSON.
 */
function loadMap() {
  if (!fs.existsSync(MAP_PATH)) {
    fs.writeFileSync(MAP_PATH, JSON.stringify({}, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
  } catch (e) {
    return {};
  }
}

/**
 * Salva o mapeamento no arquivo JSON.
 */
function saveMap(data) {
  fs.writeFileSync(MAP_PATH, JSON.stringify(data, null, 2));
}

/**
 * Normaliza um ID para apenas dígitos (máximo 15).
 */
function normalizarId(raw) {
  if (!raw) return "";
  return raw.replace(/\D/g, "").slice(-15);
}

/**
 * Atualiza o mapeamento para um usuário.
 * @param {string} lid - ID do grupo (LID)
 * @param {string} pn - Número de telefone (PN)
 */
export function atualizarMapeamento(lid, pn) {
  if (!lid || !pn) return;
  const nLid = normalizarId(lid);
  const nPn = normalizarId(pn);
  
  if (nLid === nPn) return; // Já são iguais ou não há o que mapear

  const db = loadMap();
  let mudou = false;

  // Mapear LID -> PN
  if (db[nLid] !== nPn) {
    db[nLid] = nPn;
    mudou = true;
  }

  // Mapear PN -> LID (opcional, mas útil para busca reversa)
  if (db[nPn] !== nLid) {
    db[nPn] = nLid;
    mudou = true;
  }

  if (mudou) {
    saveMap(db);
    console.log(`🔗 [MAPPER] Mapeamento atualizado: ${nLid} ↔ ${nPn}`);
  }
}

/**
 * Retorna o ID correspondente (LID se passar PN, ou PN se passar LID).
 * Se não encontrar, retorna o próprio ID original.
 */
export function resolverId(id) {
  const normalizado = normalizarId(id);
  const db = loadMap();
  return db[normalizado] || normalizado;
}

/**
 * Verifica se dois IDs pertencem ao mesmo usuário (via mapeamento ou igualdade).
 */
export function idsMatch(id1, id2) {
  const n1 = normalizarId(id1);
  const n2 = normalizarId(id2);
  
  if (n1 === n2) return true;
  
  // Verificação especial para ROOT (Fernando)
  const isN1Root = ROOT_HARDCODED.includes(n1);
  const isN2Root = ROOT_HARDCODED.includes(n2);
  
  // Se um for ROOT e o outro também for um dos IDs conhecidos do ROOT
  if (isN1Root && isN2Root) return true;
  
  // Se um for ROOT e o outro for o ROOT_ID do .env (fallback)
  const envRoot = process.env.ROOT_ID ? normalizarId(process.env.ROOT_ID) : null;
  if (isN1Root && n2 === envRoot) return true;
  if (isN2Root && n1 === envRoot) return true;

  const db = loadMap();
  
  // Se n1 mapeia para n2 ou vice-versa
  if (db[n1] === n2) return true;
  if (db[n2] === n1) return true;
  
  // Se ambos mapeiam para o mesmo terceiro ID
  if (db[n1] && db[n1] === db[n2]) return true;

  return false;
}

// ============================================================
// FIM userMapper.js
// ============================================================
