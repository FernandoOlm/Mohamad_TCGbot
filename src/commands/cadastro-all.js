// INÍCIO cadastroAll.js — /cadastro-all

import fs from "fs";
import path from "path";

const AUTH_PATH = path.resolve("src/data/auth/allowed.json");

function loadJSON() {
  return JSON.parse(fs.readFileSync(AUTH_PATH));
}

function saveJSON(data) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2));
}

export async function comandoCadastroAll(msg, sock, fromClean, args) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { status: "erro", tipo: "cadastro-all", motivo: "nao_grupo" };
  }

  const db = loadJSON();

  if (!db.grupos[jid]) {
    return { status: "erro", tipo: "cadastro-all", motivo: "grupo_sem_autorizacao" };
  }

  const grupo = db.grupos[jid];

  // Normalizar ID para comparar com autorizados
  const fromNorm = fromClean.replace(/\D/g, "").slice(-15);
  if (!grupo.autorizados.includes(fromNorm)) {
    return { status: "erro", tipo: "cadastro-all", motivo: "nao_autorizado" };
  }

  // args é um array de palavras, juntar como texto
  const textoOriginal = Array.isArray(args) ? args.join(" ").trim() : (args || "").toString().trim();

  if (!textoOriginal || textoOriginal.length === 0) {
    return { status: "erro", tipo: "cadastro-all", motivo: "mensagem_vazia" };
  }

  grupo.mensagemAll = textoOriginal;
  saveJSON(db);

  return {
    status: "ok",
    tipo: "cadastro-all",
    mensagem: `Mensagem do !all atualizada para: ${grupo.mensagemAll}`,
  };
}

// FIM cadastroAll.js
