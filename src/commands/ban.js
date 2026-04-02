/* ---------------------------------------------------
   ban.js — Sistema de BAN Global + Expulsão + Alertas + Logs (SQLite Version)
--------------------------------------------------- */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { aiGenerateReply_Unique01 } from "../core/aiClient.js";
import { dbRun, dbGet, dbQuery } from "../core/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jsonPath = path.join(__dirname, "../data/bans.json");

// Migração automática do JSON para SQLite
async function migrarJsonParaSQLite() {
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, "utf8").trim();
      if (!raw) return;
      const data = JSON.parse(raw);
      const globalBans = data.global || [];

      for (const b of globalBans) {
        await dbRun(
          `INSERT INTO bans (alvo, admin, grupo_origem, motivo, data) VALUES (?, ?, ?, ?, ?)`,
          [b.alvo, b.admin, b.grupoOrigem, b.motivo, b.data]
        );
      }
      fs.renameSync(jsonPath, jsonPath + ".bak");
      console.log("✅ Migração de Bans JSON para SQLite concluída.");
    } catch (e) {
      console.error("❌ Erro na migração de Bans:", e);
    }
  }
}

migrarJsonParaSQLite();

/* ---------------------------------------------------
   Expulsor Universal
--------------------------------------------------- */
async function expulsarDoGrupo(sock, groupId, alvo) {
  const idsPossiveis = [`${alvo}@s.whatsapp.net`, `${alvo}@lid`, `${alvo}@c.us` ];
  for (const jid of idsPossiveis) {
    try {
      await new Promise((r) => setTimeout(r, 200));
      await sock.groupParticipantsUpdate(groupId, [jid], "remove");
      return true;
    } catch (err) {}
  }
  return false;
}

/* ---------------------------------------------------
   !ban (MULTI USER)
--------------------------------------------------- */
export async function ban(msg, sock, fromClean, args) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { status: "erro", motivo: "nao_grupo" };

  const alvosTags = args.filter((a) => a.startsWith("@"));
  if (!alvosTags.length) return { status: "erro", motivo: "formato_invalido" };

  const motivoParts = args.filter((a) => !a.startsWith("@"));
  const motivo = motivoParts.length > 0 ? motivoParts.join(" ") : "sem motivo informado";

  let banidos = [];
  for (const alvoTag of alvosTags) {
    const alvo = alvoTag.replace("@", "").replace(/\D/g, "");
    if (alvo === fromClean) continue;

    await dbRun(
      `INSERT INTO bans (alvo, admin, grupo_origem, motivo, data) VALUES (?, ?, ?, ?, ?)`,
      [alvo, fromClean, groupId, motivo, Date.now()]
    );

    const sucesso = await expulsarDoGrupo(sock, groupId, alvo);
    if (sucesso) banidos.push(alvo);
  }

  if (!banidos.length) return { status: "erro", motivo: "falha_expulsao" };

  const total = banidos.length;
  const anuncioIA = await aiGenerateReply_Unique01(
    `Confirme em 1 frase curta e natural que ${total} ${total === 1 ? "pessoa foi removida" : "pessoas foram removidas"} do grupo. Motivo: "${motivo}". Sem citar nomes ou @.`
  );

  const despedida = await aiGenerateReply_Unique01(
    `Escreva uma frase curta e direta encerrando o assunto do banimento. Motivo: "${motivo}". Sem citar nomes ou @.`
  );

  return { status: "ok", tipo: "ban", total: banidos.length, anuncioIA, despedida };
}

/* ---------------------------------------------------
   !unban
--------------------------------------------------- */
export async function unban(msg, sock, fromClean, args) {
  const alvoTag = args[0];
  if (!alvoTag || !alvoTag.startsWith("@")) return { status: "erro", motivo: "formato_invalido" };

  const alvo = alvoTag.replace("@", "").replace(/\D/g, "");
  const result = await dbRun(`DELETE FROM bans WHERE alvo = ?`, [alvo]);

  if (result.changes === 0) return { status: "erro", motivo: "nao_existe" };

  return { status: "ok", tipo: "unban", removidos: result.changes, mensagem: `ID ${alvo} removido da lista de banidos.` };
}

/* ---------------------------------------------------
   !bans — do grupo
--------------------------------------------------- */
export async function bansGrupo(msg, sock) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { status: "erro", motivo: "nao_grupo" };

  const rows = await dbQuery(`SELECT * FROM bans WHERE grupo_origem = ?`, [groupId]);
  if (!rows.length) return { status: "ok", tipo: "bans_grupo", mensagem: "📜 *Bans deste grupo*\n\nNenhum ban registrado." };

  let texto = "📜 *Bans deste grupo*\n\n";
  for (const b of rows) {
    texto += `• ID: ${b.alvo}\n  Motivo: ${b.motivo}\n\n`;
  }
  return { status: "ok", tipo: "bans_grupo", mensagem: texto };
}

/* ---------------------------------------------------
   !globalbans
--------------------------------------------------- */
export async function bansGlobais(msg, sock) {
  const rows = await dbQuery(`SELECT * FROM bans`);
  if (!rows.length) return { status: "ok", tipo: "globalbans", mensagem: "🌍 *Bans Globais*\n\nNenhum ban global registrado." };

  let texto = "🌍 *Bans Globais*\n\n";
  for (const b of rows) {
    texto += `• ID: ${b.alvo}\n  Motivo: ${b.motivo}\n  Grupo: ${b.grupo_origem.replace("@g.us", "")}\n\n`;
  }
  return { status: "ok", tipo: "globalbans", mensagem: texto };
}

/* ---------------------------------------------------
   EXPULSÃO AUTOMÁTICA ao entrar — banido detectado
--------------------------------------------------- */
export async function banCheckEntrada_Unique01(sock, groupId, usuario) {
  const alvo = usuario.replace(/@.*/, "");
  const banido = await dbGet(`SELECT * FROM bans WHERE alvo = ?`, [alvo]);
  if (!banido) return null;

  let meta;
  let nomeGrupo = "desconhecido";
  try {
    meta = await sock.groupMetadata(groupId);
    nomeGrupo = meta.subject;
  } catch {}

  // 1. Expulsa imediatamente — prioridade máxima
  const expulso = await expulsarDoGrupo(sock, groupId, alvo);

  // 2. Aviso no próprio grupo
  try {
    const motivoTexto = banido.motivo || "sem motivo registrado";
    await sock.sendMessage(groupId, {
      text: `🚫 *Acesso negado.*\nUm usuário banido tentou entrar e foi removido automaticamente.\nMotivo: _${motivoTexto}_`
    });
  } catch {}

  // 3. Alerta privado para cada admin
  const admins = meta?.participants?.filter(
    (p) => p.admin === "admin" || p.admin === "superadmin"
  ) || [];

  if (admins.length) {
    const alerta =
      `⚠️ *ALERTA DE SEGURANÇA — ${nomeGrupo}*\n\n` +
      `Um usuário da lista de banidos tentou entrar.\n\n` +
      `• ID: ${banido.alvo}\n` +
      `• Motivo: ${banido.motivo || "sem motivo"}\n` +
      `• Expulso: ${expulso ? "Sim ✅" : "Falha ❌ — verifique manualmente"}`;
    for (const adm of admins) {
      try { await sock.sendMessage(adm.id, { text: alerta }); } catch {}
    }
  }

  return true;
}

/* ---------------------------------------------------
   !limpar-bans
--------------------------------------------------- */
export async function limparBans(msg, sock) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { status: "erro", motivo: "nao_grupo" };

  const rows = await dbQuery(`SELECT * FROM bans`);
  let meta;
  try {
    meta = await sock.groupMetadata(groupId);
  } catch {
    return { status: "erro", mensagem: "Erro ao acessar grupo" };
  }

  const participantes = meta.participants.map((p) => ({ id: p.id.replace(/@.*/, ""), admin: p.admin }));
  let removidos = 0;

  for (const b of rows) {
    const alvoInfo = participantes.find((p) => p.id === b.alvo);
    if (!alvoInfo || alvoInfo.admin) continue;

    const sucesso = await expulsarDoGrupo(sock, groupId, b.alvo);
    if (sucesso) {
      removidos++;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { status: "ok", tipo: "limpar_bans", mensagem: `${removidos} banidos removidos do grupo.` };
}
