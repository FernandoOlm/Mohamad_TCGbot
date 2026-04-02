// ================================
// reputacao.js
// ================================
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { dbRun, dbGet } from "../core/database.js";

const PATH_DB = path.resolve("src/data/reputacao.json");
const SALT = process.env.SALT_SECRETO || "salt_forte_aqui";

// ================================
// DB local (reputação por grupo)
// ================================
function ensureDB() {
  if (!fs.existsSync(PATH_DB)) {
    fs.writeFileSync(PATH_DB, JSON.stringify({}, null, 2));
  }
}
function loadDB() {
  ensureDB();
  return JSON.parse(fs.readFileSync(PATH_DB, "utf8"));
}
function saveDB(db) {
  fs.writeFileSync(PATH_DB, JSON.stringify(db, null, 2));
}

// ================================
// HASH LGPD
// ================================
function hashNumero(numero, grupo) {
  return crypto
    .createHash("sha256")
    .update(numero + grupo + SALT)
    .digest("hex");
}

// ================================
// EXTRATOR UNIVERSAL (vCard + reply + texto)
// ================================
function extrairNumerosUniversal(msg) {
  const numeros = new Set();
  let m = msg.message;
  if (m?.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m?.viewOnceMessage) m = m.viewOnceMessage.message;

  const extrairTudo = (texto) => {
    if (!texto) return;
    const encontrados = texto.match(/\d{10,20}/g);
    if (encontrados) encontrados.forEach(n => numeros.add(n));
  };

  // 1. Lista de vCards (grupo de contatos)
  if (m?.contactsArrayMessage?.contacts) {
    for (const contato of m.contactsArrayMessage.contacts) extrairTudo(contato.vcard);
  }
  // 2. Um único vCard
  if (m?.contactMessage?.vcard) extrairTudo(m.contactMessage.vcard);
  // 3. Reply (mensagem citada)
  const context = m?.extendedTextMessage?.contextInfo;
  if (context?.quotedMessage?.contactMessage?.vcard) {
    extrairTudo(context.quotedMessage.contactMessage.vcard);
  }
  if (context?.quotedMessage?.contactsArrayMessage?.contacts) {
    for (const c of context.quotedMessage.contactsArrayMessage.contacts) extrairTudo(c.vcard);
  }
  // 4. Texto livre (fallback)
  const texto = m?.conversation || m?.extendedTextMessage?.text || "";
  extrairTudo(texto);

  return [...numeros];
}

// ================================
// BASE
// ================================
function criarBase() {
  return { ban: [], redflag: [] };
}

// ================================
// DELAY HUMANO — tempo aleatório entre ações
// Simula comportamento humano, evita detecção do Meta
// ================================
function delayHumano(minMs = 800, maxMs = 2500) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}

// ================================
// BANIR
// O que faz:
//   1. Registra na reputação local (hash LGPD)
//   2. Registra no ban global SQLite
//   3. Se o número ESTÁ NO GRUPO ATUAL, expulsa com delay humano
//   4. NÃO faz add+remove — isso desconecta o Baileys e é detectado pelo Meta
//
// A proteção de outros grupos é feita pelo banCheckEntrada_Unique01 (ban.js)
// que expulsa automaticamente quando o banido tenta entrar em qualquer grupo.
// ================================
export async function banir(msg, sock, from, args) {
  try {
    const grupo = msg.key.remoteJid;
    if (!grupo.includes("@g.us")) {
      return { texto: "❌ Apenas em grupo." };
    }

    const motivo = args?.join(" ")?.trim();
    if (!motivo) {
      return { texto: "❌ Use: !banir [motivo]" };
    }

    const numeros = extrairNumerosUniversal(msg);
    if (!numeros.length) {
      return { texto: "❌ Nenhum número encontrado. Responda um vCard ou mencione o número." };
    }

    // Carrega participantes do grupo atual para saber quem está dentro
    let participantes = [];
    try {
      const meta = await sock.groupMetadata(grupo);
      participantes = meta.participants.map(p => p.id.replace(/@.*/, ""));
    } catch {}

    const db = loadDB();
    if (!db[grupo]) db[grupo] = {};

    let totalRegistrado = 0;
    let totalExpulsoAgora = 0;
    let totalJaBanido = 0;

    for (const numero of numeros) {
      // --- 1. Reputação local (hash LGPD) ---
      const id = hashNumero(numero, grupo);
      if (!db[grupo][id]) db[grupo][id] = criarBase();
      const lista = db[grupo][id].ban;
      lista.push({ motivo, autor: from, data: Date.now() });
      if (lista.length > 20) lista.shift();

      // --- 2. Ban global SQLite ---
      const jaBanido = await dbGet(`SELECT id FROM bans WHERE alvo = ?`, [numero]);
      if (jaBanido) {
        totalJaBanido++;
      } else {
        await dbRun(
          `INSERT OR IGNORE INTO bans (alvo, admin, grupo_origem, motivo, data) VALUES (?, ?, ?, ?, ?)`,
          [numero, from, grupo, motivo, Date.now()]
        );
        totalRegistrado++;
      }

      // --- 3. Se está no grupo atual, expulsa com delay humano ---
      if (participantes.includes(numero)) {
        // Delay humano antes de expulsar (entre 1s e 3s)
        await delayHumano(1000, 3000);
        const idsPossiveis = [
          `${numero}@s.whatsapp.net`,
          `${numero}@lid`,
          `${numero}@c.us`
        ];
        for (const jid of idsPossiveis) {
          try {
            await sock.groupParticipantsUpdate(grupo, [jid], "remove");
            totalExpulsoAgora++;
            break;
          } catch {}
        }
        // Delay humano após expulsar
        await delayHumano(800, 2000);
      }
    }

    saveDB(db);

    // Relatório final
    let resposta = `🚫 *BANIMENTO — ${motivo}*\n\n`;
    resposta += `📇 Contatos: *${numeros.length}*\n`;
    if (totalRegistrado > 0) resposta += `🌍 Adicionados à lista global: *${totalRegistrado}*\n`;
    if (totalJaBanido > 0) resposta += `🔒 Já estavam banidos: *${totalJaBanido}*\n`;
    if (totalExpulsoAgora > 0) resposta += `⚔️ Expulsos deste grupo agora: *${totalExpulsoAgora}*\n`;
    resposta += `\n✅ Se tentarem entrar em qualquer grupo, serão expulsos automaticamente.`;

    return { texto: resposta };

  } catch (err) {
    console.error("ERRO BANIR:", err);
    return { texto: "❌ Erro ao processar o banimento." };
  }
}

// ================================
// RED FLAG (leve — apenas reputação local)
// ================================
export async function redFlag(msg, sock, from, args) {
  try {
    const motivo = args?.join(" ")?.trim();
    if (!motivo) return { texto: "❌ Use: !red-flag [motivo]" };

    const numeros = extrairNumerosUniversal(msg);
    if (!numeros.length) return { texto: "❌ Nenhum número encontrado." };

    const db = loadDB();
    const grupo = msg.key.remoteJid;
    if (!db[grupo]) db[grupo] = {};

    let total = 0;
    for (const numero of numeros) {
      const id = hashNumero(numero, grupo);
      if (!db[grupo][id]) db[grupo][id] = criarBase();
      const lista = db[grupo][id].redflag;
      lista.push({ motivo, autor: from, data: Date.now() });
      if (lista.length > 20) lista.shift();
      total++;
    }

    saveDB(db);
    return { texto: `🚩 ${total} alerta(s) registrado(s): ${motivo}` };

  } catch (err) {
    console.error("ERRO REDFLAG:", err);
    return { texto: "❌ Erro." };
  }
}

// ================================
// STATUS — reputação local + ban global
// ================================
export async function status(msg, sock, from, args) {
  try {
    const numeros = extrairNumerosUniversal(msg);
    if (!numeros.length) return { texto: "❌ Nenhum número encontrado." };

    const db = loadDB();
    const grupo = msg.key.remoteJid;
    const id = hashNumero(numeros[0], grupo);
    const dados = db?.[grupo]?.[id];

    const banGlobal = await dbGet(`SELECT * FROM bans WHERE alvo = ?`, [numeros[0]]);

    if (!dados && !banGlobal) return { texto: "Nenhum registro para esse contato." };

    const bans = dados?.ban?.length || 0;
    const flags = dados?.redflag?.length || 0;

    let nivel = "✅ OK";
    if (banGlobal || bans > 0) nivel = "🚨 BANIDO GLOBAL";
    else if (flags >= 3) nivel = "⚠️ ALTO RISCO";
    else if (flags > 0) nivel = "⚠️ ATENÇÃO";

    return {
      texto: `📊 *Status do contato*\n\n🚫 Bans locais: ${bans}\n🚩 Alertas: ${flags}\n🌍 Ban global: ${banGlobal ? "Sim — " + banGlobal.motivo : "Não"}\n\nStatus: ${nivel}`
    };

  } catch (err) {
    console.error("ERRO STATUS:", err);
    return { texto: "❌ Erro." };
  }
}

// ================================
// CLEAN REPUTAÇÃO (ROOT ONLY)
// ================================
export async function cleanRep(msg, sock, from, args) {
  try {
    const ROOT = process.env.ROOT_ID;
    if (from !== ROOT) return { texto: "❌ Apenas o root pode usar esse comando." };
    fs.writeFileSync(PATH_DB, JSON.stringify({}, null, 2));
    return { texto: "🧹 Reputação local limpa com sucesso." };
  } catch (err) {
    console.error("ERRO CLEAN REP:", err);
    return { texto: "❌ Erro ao limpar reputação." };
  }
}

// ================================
// FIM
// ================================
