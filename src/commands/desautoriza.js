// ============================================================
// desautoriza.js — Comando !desautoriza @fulano
// Remove a autorização do usuário de usar comandos do bot
// Apenas admins e root podem executar
// ============================================================

import fs from "fs";
import path from "path";

const AUTH_PATH = path.resolve("src/data/auth/allowed.json");
const ANUNCIOS_PATH = path.resolve("src/data/anuncios.json");

function loadAuth() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return { grupos: {}, privados: {} };
    return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  } catch { return { grupos: {}, privados: {} }; }
}

function saveAuth(db) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(db, null, 2));
}

function loadAnuncios() {
  try {
    if (!fs.existsSync(ANUNCIOS_PATH)) return { grupos: {} };
    return JSON.parse(fs.readFileSync(ANUNCIOS_PATH, "utf8"));
  } catch { return { grupos: {} }; }
}

function saveAnuncios(db) {
  fs.writeFileSync(ANUNCIOS_PATH, JSON.stringify(db, null, 2));
}

export async function comandoDesautoriza(msg, sock, fromClean, args) {
  try {
    const jid = msg.key.remoteJid;

    // Pegar @menção do usuário alvo
    const mencoes = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;

    // Também aceitar número direto como argumento: !desautoriza 5511999998888
    let alvoJid = null;
    let alvoNumero = null;

    if (mencoes && mencoes.length > 0) {
      alvoJid = mencoes[0];
      alvoNumero = alvoJid.replace(/@.*/, "").replace(/\D/g, "");
    } else if (args && args.length > 0) {
      // Tentar extrair número do argumento
      const numArg = args[0].replace(/\D/g, "");
      if (numArg.length >= 5) {
        alvoNumero = numArg;
        alvoJid = `${alvoNumero}@s.whatsapp.net`;
      }
    }

    if (!alvoNumero) {
      return {
        mensagem: "❌ Use: *!desautoriza @fulano*\n\nMencione o usuário que deseja desautorizar."
      };
    }

    // Normalizar número (últimos 15 dígitos, como o bot faz)
    const alvoClean = alvoNumero.slice(-15);

    // Verificar se é grupo ou PV
    const isGroup = jid.endsWith("@g.us");
    const removidos = [];

    // ===== 1) Remover de allowed.json (autorizações gerais) =====
    const authDB = loadAuth();

    if (isGroup) {
      const grupo = authDB.grupos[jid];
      if (grupo && grupo.autorizados) {
        const antes = grupo.autorizados.length;
        // Filtrar removendo o alvo (comparar com e sem normalização)
        grupo.autorizados = grupo.autorizados.filter(id => {
          const idClean = id.replace(/\D/g, "").slice(-15);
          return idClean !== alvoClean;
        });
        if (grupo.autorizados.length < antes) {
          removidos.push("comandos do bot");
        }
      }
    } else {
      // PV: remover das autorizações privadas
      if (authDB.privados[alvoClean]) {
        delete authDB.privados[alvoClean];
        removidos.push("acesso privado");
      }
      // Também tentar com número completo
      if (authDB.privados[alvoNumero]) {
        delete authDB.privados[alvoNumero];
        if (!removidos.includes("acesso privado")) removidos.push("acesso privado");
      }
    }

    saveAuth(authDB);

    // ===== 2) Remover de anuncios.json (autorização de anúncio) =====
    if (isGroup) {
      const anunciosDB = loadAnuncios();
      const grupoAnuncio = anunciosDB.grupos?.[jid];
      if (grupoAnuncio && grupoAnuncio.autorizados) {
        const antes = grupoAnuncio.autorizados.length;
        grupoAnuncio.autorizados = grupoAnuncio.autorizados.filter(id => {
          const idClean = id.replace(/@.*/, "").replace(/\D/g, "").slice(-15);
          return idClean !== alvoClean;
        });
        if (grupoAnuncio.autorizados.length < antes) {
          removidos.push("anúncios");
        }
        saveAnuncios(anunciosDB);
      }
    }

    // ===== Resultado =====
    if (removidos.length === 0) {
      return {
        mensagem: `⚠️ @${alvoNumero} não tinha nenhuma autorização neste ${isGroup ? "grupo" : "chat"}.`,
        mentions: alvoJid ? [alvoJid] : []
      };
    }

    const listaRemovidos = removidos.join(", ");
    return {
      mensagem: `🚫 @${alvoNumero} foi *desautorizado* de: ${listaRemovidos}.\n\nEsse usuário não poderá mais usar comandos restritos do bot neste ${isGroup ? "grupo" : "chat"}.`,
      mentions: alvoJid ? [alvoJid] : []
    };

  } catch (err) {
    console.error("[DESAUTORIZA] Erro:", err.message);
    return { mensagem: "❌ Erro ao desautorizar usuário." };
  }
}

// ============================================================
// FIM desautoriza.js
// ============================================================
