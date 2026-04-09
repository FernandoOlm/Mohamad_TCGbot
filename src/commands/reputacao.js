// ================================
// reputacao.js (GLOBAL + DETECÇÃO INTELIGENTE + ÚLTIMO MOTIVO + BUSCA STATUS)
// ================================
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { dbRun, dbGet } from "../core/database.js";

const PATH_DB = path.resolve("src/data/reputacao.json");
const SALT = process.env.SALT_SECRETO || "salt_forte_aqui";

// ================================
// DB local (reputação global)
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
// HASH LGPD (Global)
// ================================
function hashNumeroGlobal(numero) {
  return crypto
    .createHash("sha256")
    .update(numero + "GLOBAL" + SALT)
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
  // 3. Reply (mensagem citada) - vCard
  const context = m?.extendedTextMessage?.contextInfo;
  if (context?.quotedMessage?.contactMessage?.vcard) {
    extrairTudo(context.quotedMessage.contactMessage.vcard);
  }
  if (context?.quotedMessage?.contactsArrayMessage?.contacts) {
    for (const c of context.quotedMessage.contactsArrayMessage.contacts) extrairTudo(c.vcard);
  }
  
  // 4. Se for resposta a uma mensagem comum (não vCard), pega o autor da mensagem citada
  if (context?.participant) {
    const participant = context.participant.replace(/@.*/, "");
    if (participant.match(/^\d+$/)) {
      numeros.add(participant);
    }
  }

  // 5. Texto livre (fallback)
  const texto = m?.conversation || m?.extendedTextMessage?.text || "";
  extrairTudo(texto);

  return [...numeros];
}

function criarBase() {
  return { ban: [], redflag: [], referencias: [], scoreTotal: 0, totalVotos: 0 };
}

// ================================
// BANIR
// ================================
export async function banir(msg, sock, from, args) {
  try {
    const grupo = msg.key.remoteJid;
    const motivo = args?.join(" ")?.trim();
    if (!motivo) return { texto: "❌ Use: !banir [motivo]" };

    const numeros = extrairNumerosUniversal(msg);
    if (!numeros.length) return { texto: "❌ Nenhum número encontrado." };

    const db = loadDB();
    if (!db["global"]) db["global"] = {};

    let totalRegistrado = 0;
    for (const numero of numeros) {
      const id = hashNumeroGlobal(numero);
      if (!db["global"][id]) db["global"][id] = criarBase();
      db["global"][id].ban.push({ motivo, autor: from, data: Date.now() });

      await dbRun(
        `INSERT OR IGNORE INTO bans (alvo, admin, grupo_origem, motivo, data) VALUES (?, ?, ?, ?, ?)`,
        [numero, from, grupo, motivo, Date.now()]
      );
      totalRegistrado++;
    }

    saveDB(db);
    return { texto: `🚫 ${totalRegistrado} banimento(s) global(is) registrado(s).` };
  } catch (err) {
    console.error("ERRO BANIR:", err);
    return { texto: "❌ Erro." };
  }
}

// ================================
// RED FLAG
// ================================
export async function redFlag(msg, sock, from, args) {
  try {
    const motivo = args?.join(" ")?.trim();
    if (!motivo) return { texto: "❌ Use: !red-flag [motivo]" };

    const numeros = extrairNumerosUniversal(msg);
    if (!numeros.length) return { texto: "❌ Nenhum número encontrado." };

    const db = loadDB();
    if (!db["global"]) db["global"] = {};

    let total = 0;
    for (const numero of numeros) {
      const id = hashNumeroGlobal(numero);
      if (!db["global"][id]) db["global"][id] = criarBase();
      db["global"][id].redflag.push({ motivo, autor: from, data: Date.now() });
      total++;
    }

    saveDB(db);
    return { texto: `🚩 ${total} alerta(s) global(is) registrado(s).` };
  } catch (err) {
    console.error("ERRO REDFLAG:", err);
    return { texto: "❌ Erro." };
  }
}

// ================================
// STATUS (Lê da chave global com detecção inteligente)
// ================================
export async function status(msg, sock, from, args) {
  try {
    let numeros = extrairNumerosUniversal(msg);
    
    // Se não encontrou nada via vCard ou resposta, verifica o próprio autor
    if (!numeros.length) {
      const self = (msg.key.participant || msg.key.remoteJid).replace(/@.*/, "");
      numeros = [self];
    }

    const db = loadDB();
    const numeroAlvo = numeros[0];
    const id = hashNumeroGlobal(numeroAlvo);
    const dados = db?.["global"]?.[id];

    // Busca o banimento mais recente no SQLite
    const banGlobal = await dbGet(`SELECT * FROM bans WHERE alvo = ? ORDER BY data DESC LIMIT 1`, [numeroAlvo]);

    if (!dados && !banGlobal) {
      return { texto: `ℹ️ Nenhum registro encontrado para o contato *${numeroAlvo}*.` };
    }

    const bans = dados?.ban?.length || 0;
    const flags = dados?.redflag?.length || 0;
    const refs = dados?.referencias?.length || 0;
    const scoreTotal = dados?.scoreTotal || 0;
    const totalVotos = dados?.totalVotos || 0;
    const media = totalVotos > 0 ? (scoreTotal / totalVotos).toFixed(1) : "0.0";

    // Determina o motivo do banimento (prioriza o global do SQLite)
    let motivoBan = "";
    if (banGlobal) {
      motivoBan = banGlobal.motivo;
    } else if (bans > 0) {
      motivoBan = dados.ban[dados.ban.length - 1].motivo;
    }

    let nivel = "✅ OK";
    if (banGlobal || bans > 0) nivel = "🚨 BANIDO GLOBAL";
    else if (flags >= 3) nivel = "⚠️ ALTO RISCO";
    else if (flags > 0) nivel = "⚠️ ATENÇÃO";
    else if (media >= 4.5 && refs >= 5) nivel = "💎 CONFIÁVEL (N5)";
    else if (media >= 3.5) nivel = "⭐ BOM VENDEDOR";

    let texto = `📊 *Status Global: ${numeroAlvo}*\n\n`;
    texto += `🚫 Bans: *${bans}*\n`;
    texto += `🚩 Alertas: *${flags}*\n`;
    
    if (banGlobal || bans > 0) {
      texto += `🌍 Ban global: *Sim — ${motivoBan}*\n\n`;
    } else {
      texto += `🌍 Ban global: *Não*\n\n`;
    }

    texto += `⭐ *Score:* *${media}/5* (${totalVotos} votos)\n`;
    texto += `📝 *Referências:* *${refs}*\n\n`;
    
    if (refs > 0) {
      texto += `*Últimas referências:*\n`;
      const ultimas = dados.referencias.slice(-5).reverse();
      ultimas.forEach(r => {
        texto += `• "${r.comentario}" (N${r.nota})\n`;
      });
      texto += `\n`;
    }

    texto += `Status: *${nivel}*`;
    return { texto };
  } catch (err) {
    console.error("ERRO STATUS:", err);
    return { texto: "❌ Erro ao consultar status." };
  }
}

// ================================
// BUSCA STATUS (Grupos em comum)
// ================================
export async function buscaStatus(msg, sock, from, args) {
  try {
    let numeros = extrairNumerosUniversal(msg);
    
    if (!numeros.length) {
      return { texto: "❌ Por favor, responda a um vCard para buscar os grupos em comum." };
    }

    const numeroAlvo = numeros[0];
    const jidAlvo = numeroAlvo + "@s.whatsapp.net";
    
    // 1. Obter todos os grupos que o bot participa
    const todosGrupos = await sock.groupFetchAllParticipating();
    const gruposEmComum = [];

    // 2. Verificar em cada grupo se o alvo está presente
    for (const [jid, metadata] of Object.entries(todosGrupos)) {
      const estaNoGrupo = metadata.participants.some(p => p.id === jidAlvo);
      if (estaNoGrupo) {
        gruposEmComum.push(metadata.subject || jid);
      }
    }

    // 3. Obter dados de reputação (mesma lógica do !status)
    const db = loadDB();
    const id = hashNumeroGlobal(numeroAlvo);
    const dados = db?.["global"]?.[id];
    const banGlobal = await dbGet(`SELECT * FROM bans WHERE alvo = ? ORDER BY data DESC LIMIT 1`, [numeroAlvo]);

    const bans = dados?.ban?.length || 0;
    const flags = dados?.redflag?.length || 0;
    const refs = dados?.referencias?.length || 0;
    const scoreTotal = dados?.scoreTotal || 0;
    const totalVotos = dados?.totalVotos || 0;
    const media = totalVotos > 0 ? (scoreTotal / totalVotos).toFixed(1) : "0.0";

    let motivoBan = "";
    if (banGlobal) {
      motivoBan = banGlobal.motivo;
    } else if (bans > 0) {
      motivoBan = dados.ban[dados.ban.length - 1].motivo;
    }

    let nivel = "✅ OK";
    if (banGlobal || bans > 0) nivel = "🚨 BANIDO GLOBAL";
    else if (flags >= 3) nivel = "⚠️ ALTO RISCO";
    else if (flags > 0) nivel = "⚠️ ATENÇÃO";
    else if (media >= 4.5 && refs >= 5) nivel = "💎 CONFIÁVEL (N5)";
    else if (media >= 3.5) nivel = "⭐ BOM VENDEDOR";

    // 4. Montar a resposta final
    let texto = `📊 *Status Global: ${numeroAlvo}*\n\n`;
    texto += `🚫 Bans: *${bans}*\n`;
    texto += `🚩 Alertas: *${flags}*\n`;
    
    if (banGlobal || bans > 0) {
      texto += `🌍 Ban global: *Sim — ${motivoBan}*\n\n`;
    } else {
      texto += `🌍 Ban global: *Não*\n\n`;
    }

    texto += `⭐ *Score:* *${media}/5* (${totalVotos} votos)\n`;
    texto += `📝 *Referências:* *${refs}*\n\n`;
    
    if (refs > 0) {
      texto += `*Últimas referências:*\n`;
      const ultimas = dados.referencias.slice(-5).reverse();
      ultimas.forEach(r => {
        texto += `• "${r.comentario}" (N${r.nota})\n`;
      });
      texto += `\n`;
    }

    texto += `Status: *${nivel}*\n`;
    texto += `Grupos em Comum Ferdinando: *${gruposEmComum.length} Grupos*`;

    return { texto };
  } catch (err) {
    console.error("ERRO BUSCA STATUS:", err);
    return { texto: "❌ Erro ao buscar grupos em comum." };
  }
}

export async function cleanRep(msg, sock, from, args) {
  try {
    const ROOT = process.env.ROOT_ID;
    if (from !== ROOT) return { texto: "❌ Apenas o root pode usar esse comando." };
    fs.writeFileSync(PATH_DB, JSON.stringify({}, null, 2));
    return { texto: "🧹 Reputação global limpa com sucesso." };
  } catch (err) {
    console.error("ERRO CLEAN REP:", err);
    return { texto: "❌ Erro ao limpar reputação." };
  }
}
