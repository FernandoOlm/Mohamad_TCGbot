// --------------------------------------------------------
// FUNC_BV.JS — ENGINE + COMANDOS BV (SQLite Version)
// --------------------------------------------------------

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dbRun, dbGet, dbQuery } from "../core/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jsonPath = path.join(__dirname, "../data/bv.json");

// Migração automática do JSON para SQLite (Executada uma vez)
async function migrarJsonParaSQLite() {
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, "utf8").trim();
      if (!raw) return;
      const data = JSON.parse(raw);
      const grupos = data.grupos || data;

      for (const [jid, info] of Object.entries(grupos)) {
        if (jid.endsWith("@g.us")) {
          await dbRun(
            `INSERT OR REPLACE INTO boas_vindas (grupo_id, mensagem, ativo, atualizado) VALUES (?, ?, ?, ?)`,
            [jid, info.mensagem || "", info.ativo ? 1 : 0, info.atualizado || new Date().toISOString()]
          );
        }
      }
      // Renomeia o arquivo para evitar migrações repetidas
      fs.renameSync(jsonPath, jsonPath + ".bak");
      console.log("✅ Migração de BV JSON para SQLite concluída.");
    } catch (e) {
      console.error("❌ Erro na migração de BV:", e);
    }
  }
}

// Inicializa migração
migrarJsonParaSQLite();

// --------------------------------------------------------
// ENGINE BV
// --------------------------------------------------------

export async function engineCriarBV(jid, mensagem) {
  if (!jid.endsWith("@g.us")) {
    return { status: "erro", tipo: "criar", mensagem: "Comando disponível apenas em grupos." };
  }

  if (!mensagem || mensagem.trim() === "") {
    return { status: "erro", tipo: "criar", mensagem: "Informe o texto da mensagem de boas-vindas." };
  }

  await dbRun(
    `INSERT OR REPLACE INTO boas_vindas (grupo_id, mensagem, ativo, atualizado) VALUES (?, ?, ?, ?)`,
    [jid, mensagem.trim(), 1, new Date().toISOString()]
  );

  return { status: "ok", tipo: "criar", mensagem: `✅ Mensagem de boas-vindas criada e ativada!\n\n📝 Texto configurado:\n${mensagem.trim()}` };
}

export async function engineAtivarBV(jid) {
  const row = await dbGet(`SELECT * FROM boas_vindas WHERE grupo_id = ?`, [jid]);
  if (!row) {
    return { status: "erro", tipo: "ativar", mensagem: "Nenhuma mensagem cadastrada. Use !criar-bv primeiro." };
  }

  await dbRun(`UPDATE boas_vindas SET ativo = 1, atualizado = ? WHERE grupo_id = ?`, [new Date().toISOString(), jid]);
  return { status: "ok", tipo: "ativar", mensagem: `✅ Boas-vindas *ativada* neste grupo!\nNovos membros receberão a mensagem automaticamente.` };
}

export async function engineDesativarBV(jid) {
  const row = await dbGet(`SELECT * FROM boas_vindas WHERE grupo_id = ?`, [jid]);
  if (!row) {
    return { status: "erro", tipo: "desativar", mensagem: "Nenhuma mensagem cadastrada." };
  }

  await dbRun(`UPDATE boas_vindas SET ativo = 0, atualizado = ? WHERE grupo_id = ?`, [new Date().toISOString(), jid]);
  return { status: "ok", tipo: "desativar", mensagem: `⚠️ Boas-vindas *desativada* neste grupo.\nNovos membros não receberão mensagem automática.` };
}

export async function engineVerBV(jid) {
  const row = await dbGet(`SELECT * FROM boas_vindas WHERE grupo_id = ?`, [jid]);
  if (!row) {
    return { status: "ok", tipo: "ver", ativo: false, mensagem: "Nenhuma mensagem configurada para este grupo." };
  }

  const status = row.ativo ? "ativa" : "desativada";
  return { status: "ok", tipo: "ver", ativo: !!row.ativo, mensagem: `BV ${status}:\n\n${row.mensagem}` };
}

export async function engineDeletarBV(jid) {
  const row = await dbGet(`SELECT * FROM boas_vindas WHERE grupo_id = ?`, [jid]);
  if (!row) {
    return { status: "erro", tipo: "deletar", mensagem: "Nenhuma mensagem para remover." };
  }

  await dbRun(`DELETE FROM boas_vindas WHERE grupo_id = ?`, [jid]);
  return { status: "ok", tipo: "deletar", mensagem: `🗑️ Mensagem de boas-vindas removida deste grupo.` };
}

// --------------------------------------------------------
// COMANDOS BV
// --------------------------------------------------------

export async function comandoCriarBV(msg, sock) {
  const jid = msg.key.remoteJid;
  const txt = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  const textoBV = txt.replace(/^!criar-bv\s*/i, "").trim();
  return { tipo: "criar_bv", ...(await engineCriarBV(jid, textoBV)) };
}

export async function comandoAtivarBV(msg, sock) {
  return { tipo: "ativar_bv", ...(await engineAtivarBV(msg.key.remoteJid)) };
}

export async function comandoDesativarBV(msg, sock) {
  return { tipo: "desativar_bv", ...(await engineDesativarBV(msg.key.remoteJid)) };
}

export async function comandoVerBV(msg, sock) {
  return { tipo: "ver_bv", ...(await engineVerBV(msg.key.remoteJid)) };
}

export async function comandoDelBV(msg, sock) {
  return { tipo: "del_bv", ...(await engineDeletarBV(msg.key.remoteJid)) };
}
