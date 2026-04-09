/* ===================================================
   limparbans.js — Limpa banidos do grupo usando lista global SQLite
   
   Correção: usa idsMatch para comparar LID ↔ PN corretamente,
   e extrai todos os formatos de ID de cada participante (p.id, p.lid, p.jid)
   para garantir match com os alvos salvos pelo !banir via vCard.
=================================================== */
import { dbQuery } from "../core/database.js";
import { idsMatch } from "../utils/userMapper.js";

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

/**
 * Normaliza um ID removendo tudo que não é dígito e pegando os últimos 15.
 */
function normalizarId(raw) {
  if (!raw) return "";
  return raw.replace(/\D/g, "").slice(-15);
}

/**
 * Extrai todos os IDs possíveis de um participante do grupo.
 * O Baileys pode fornecer p.id, p.lid e p.jid — cada um em formato diferente.
 * Retorna um array de IDs normalizados (sem duplicatas).
 */
function extrairIdsParticipante(p) {
  const ids = new Set();

  // p.id pode ser "5547926714770:23@s.whatsapp.net" ou "84113344188640@lid"
  if (p.id) {
    // Remove sufixo @... e tudo após ":"
    const limpo = p.id.split(":")[0].replace(/@.*/, "");
    const norm = normalizarId(limpo);
    if (norm) ids.add(norm);
  }

  // p.lid é o LID puro (ex: "84113344188640@lid")
  if (p.lid) {
    const norm = normalizarId(p.lid.replace(/@.*/, ""));
    if (norm) ids.add(norm);
  }

  // p.jid é o número de telefone (ex: "5547926714770@s.whatsapp.net")
  if (p.jid) {
    const norm = normalizarId(p.jid.replace(/@.*/, ""));
    if (norm) ids.add(norm);
  }

  return [...ids];
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

  // Normalizar alvos banidos
  const alvosNormalizados = bans.map(b => normalizarId(b.alvo));

  let removidos = 0;
  let jaVerificados = new Set(); // Evitar tentar expulsar o mesmo participante 2x

  for (const p of meta.participants) {
    // Nunca remove admin (segurança)
    if (p.admin === "admin" || p.admin === "superadmin") continue;

    // Extrair todos os IDs possíveis deste participante
    const idsParticipante = extrairIdsParticipante(p);

    // Verificar se algum ID deste participante bate com algum alvo banido
    let encontrouBan = false;
    let idParaExpulsar = p.id.split(":")[0].replace(/@.*/, "");

    for (const idP of idsParticipante) {
      if (jaVerificados.has(idP)) continue;

      for (const alvoBan of alvosNormalizados) {
        // Comparação direta (rápida)
        if (idP === alvoBan) {
          encontrouBan = true;
          break;
        }
        // Comparação via mapeamento LID ↔ PN (resolve identidades cruzadas)
        if (idsMatch(idP, alvoBan)) {
          encontrouBan = true;
          break;
        }
      }

      if (encontrouBan) break;
    }

    if (!encontrouBan) continue;

    // Marcar todos os IDs como verificados
    for (const idP of idsParticipante) {
      jaVerificados.add(idP);
    }

    // Tentar expulsar usando o ID principal e também os alternativos
    let expulso = false;

    // Tentar com cada ID possível
    for (const idP of idsParticipante) {
      if (expulso) break;
      expulso = await expulsar(sock, groupId, idP);
    }

    if (expulso) {
      removidos++;
      console.log(`🧹 [LIMPAR-BANS] Removido: ${idsParticipante.join(" / ")} de ${nomeGrupo}`);
      // Delay humanizado entre expulsões
      await new Promise(r => setTimeout(r, 800));
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
