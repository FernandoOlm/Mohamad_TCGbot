// ================================
// add-ref.js — Adiciona referências e score a usuários (GLOBAL)
// ================================
import fs from "fs";
import path from "path";
import crypto from "crypto";

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
// HASH LGPD (Global — não usa o grupo na chave)
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

function criarBase() {
  return { ban: [], redflag: [], referencias: [], scoreTotal: 0, totalVotos: 0 };
}

// ================================
// COMANDO !add-ref
// ================================
export async function comandoAddRef(msg, sock, from, args) {
  try {
    const grupoJid = msg.key.remoteJid;
    const textoCompleto = args?.join(" ")?.trim();
    
    if (!textoCompleto) {
      return { texto: "❌ Use: !add-ref [comentário] N[0-5]\nExemplo: !add-ref Compro sempre sem medo! N5" };
    }

    // Extrair nota (N0 a N5)
    const matchNota = textoCompleto.match(/N([0-5])/i);
    if (!matchNota) {
      return { texto: "❌ Você precisa incluir a nota de N0 a N5 no final do texto.\nExemplo: !add-ref Ótimo vendedor! N5" };
    }

    const nota = parseInt(matchNota[1]);
    const comentario = textoCompleto.replace(/N[0-5]/i, "").trim();

    const numeros = extrairNumerosUniversal(msg);
    if (!numeros.length) {
      return { texto: "❌ Nenhum número encontrado. Responda a um vCard ou mencione o número." };
    }

    const db = loadDB();
    // Usamos uma chave fixa "global" para que todos os grupos compartilhem a mesma reputação
    if (!db["global"]) db["global"] = {};

    let totalRegistrado = 0;
    for (const numero of numeros) {
      const id = hashNumeroGlobal(numero);
      if (!db["global"][id]) db["global"][id] = criarBase();
      
      // Inicializar campos se não existirem (migração)
      if (!db["global"][id].referencias) db["global"][id].referencias = [];
      if (db["global"][id].scoreTotal === undefined) db["global"][id].scoreTotal = 0;
      if (db["global"][id].totalVotos === undefined) db["global"][id].totalVotos = 0;

      // Adicionar referência
      db["global"][id].referencias.push({
        comentario,
        nota,
        autor: from,
        grupo: grupoJid, // Guardamos o grupo apenas para registro histórico
        data: Date.now()
      });

      // Atualizar score
      db["global"][id].scoreTotal += nota;
      db["global"][id].totalVotos += 1;

      // Limitar histórico de referências
      if (db["global"][id].referencias.length > 100) db["global"][id].referencias.shift();
      
      totalRegistrado++;
    }

    saveDB(db);

    // Reagir com emoji para evitar flood no grupo
    await sock.sendMessage(grupoJid, {
      react: {
        text: "👍",
        key: msg.key
      }
    });

    return null; // Retorna null para o dispatcher não enviar texto extra

  } catch (err) {
    console.error("ERRO ADD-REF:", err);
    return { texto: "❌ Erro ao processar a referência." };
  }
}
