/* ===================================================
   limparbans.js — Lê da lista global SQLite (fonte correta)
=================================================== */
import { dbQuery } from "../core/database.js";

async function expulsar(sock, groupId, alvo) {
  const ids = [
    `${alvo}@s.whatsapp.net`,
    `${alvo}@lid`,
    `${alvo}@c.us`,
  ];
  for (const jid of ids) {
    try {
      await sock.groupParticipantsUpdate(groupId, [jid], "remove");
      return true;
    } catch {}
  }
  return false;
}

export async function limparBans(msg, sock) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) {
    return { status: "erro", motivo: "nao_grupo" };
  }

  // Carrega todos os bans globais do SQLite
  const bans = await dbQuery(`SELECT alvo FROM bans`, []);
  if (!bans.length) {
    return {
      status: "ok",
      tipo: "limpar_bans",
      mensagem: "✅ Nenhum banido registrado na lista global."
    };
  }

  // Carrega participantes do grupo
  let meta;
  try {
    meta = await sock.groupMetadata(groupId);
  } catch {
    return { status: "erro", mensagem: "⚠️ Falha ao obter dados do grupo." };
  }

  const nomeGrupo = meta.subject || "Grupo";

  // Mapa de participantes: numero → admin
  const participantesMap = new Map();
  for (const p of meta.participants) {
    const num = p.id.split(":")[0].replace(/@.*/, "");
    participantesMap.set(num, p.admin);
  }

  let removidos = 0;
  const alvosNoBanidos = bans.map(b => b.alvo);

  for (const alvo of alvosNoBanidos) {
    // Só age se o banido estiver no grupo
    if (!participantesMap.has(alvo)) continue;
    // Nunca remove admin (segurança)
    if (participantesMap.get(alvo)) continue;

    const ok = await expulsar(sock, groupId, alvo);
    if (ok) {
      removidos++;
      await new Promise(r => setTimeout(r, 600));
    }
  }

  if (removidos === 0) {
    return {
      status: "ok",
      tipo: "limpar_bans",
      mensagem: `✅ *${nomeGrupo}* está limpo — nenhum banido encontrado no grupo.`
    };
  }

  return {
    status: "ok",
    tipo: "limpar_bans",
    mensagem: `🧹 *${nomeGrupo}* limpo!\n🚫 ${removidos} banido(s) removido(s).`
  };
}
/* ===================================================
   FIM
=================================================== */
