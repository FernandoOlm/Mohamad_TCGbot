// INÍCIO index.js — Versão Reset Geral (VPS Friendly) + Sistema de Leilão v3 (DEBUG + FIX)
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import pino from "pino";
import crypto from "crypto";
import { fileURLToPath } from "url";

// Importação de comandos e utilitários
import { botLoggerRegisterEvent_Unique01 } from "../utils/logger.js";
import { clawBrainProcess_Unique01 } from "./clawBrain.js";
import { ensureAuthFile } from "../commands/auth.js";
import { atualizarGrupo_Unique03 } from "../utils/groups.js";
import { banCheckEntrada_Unique01 } from "../commands/ban.js";
import { dbGet } from "./database.js";
import { verificarAnuncioAuto } from "../commands/anuncio-controle.js";

// Importação do sistema de leilão
import {
  storeMessage,
  getStoredMessage,
  registrarVotosAgregados,
  registrarVotoFallback,
  temSessaoAtiva,
  registrarEnquete,
  getSessaoAtiva,
  computeOptionHash,
} from "./leilaoManager.js";

// Configuração de diretórios
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Funções de Boas-Vindas (BV) via SQLite
export async function lerBV(grupoId) {
  try {
    const row = await dbGet(`SELECT * FROM boas_vindas WHERE grupo_id = ?`, [grupoId]);
    if (!row) return null;
    return {
      mensagem: row.mensagem,
      ativo: !!row.ativo,
      atualizado: row.atualizado
    };
  } catch (e) {
    return null;
  }
}

const ROOT = process.env.ROOT_ID;

// LOGGER SILENCIOSO PARA BAILEYS (VPS FRIENDLY)
const logger = pino({ level: "silent" });

// CORES PARA O CONSOLE
const C = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  white: "\x1b[37m",
  red: "\x1b[31m",
};

ensureAuthFile();

// Tenta importar decryptPollVote e getAggregateVotesInPollMessage do Baileys
let decryptPollVote = null;
let getAggregateVotesInPollMessage = null;
try {
  const baileys = await import("@whiskeysockets/baileys");
  if (typeof baileys.decryptPollVote === "function") {
    decryptPollVote = baileys.decryptPollVote;
    console.log("✅ [LEILÃO] decryptPollVote disponível — decryption manual de votos ativa!");
  }
  if (typeof baileys.getAggregateVotesInPollMessage === "function") {
    getAggregateVotesInPollMessage = baileys.getAggregateVotesInPollMessage;
    console.log("✅ [LEILÃO] getAggregateVotesInPollMessage disponível.");
  }
} catch (e) {
  console.log("⚠️ [LEILÃO] Erro ao importar funções do Baileys:", e.message);
}

// LOG DE CONSOLE OTIMIZADO
function formatLog(msg, texto, isGroup, groupName, fromClean) {
  const d = new Date();
  const stamp = `${C.cyan}| ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")} |`;
  
  if (isGroup) {
    return `${stamp} ${C.yellow}GRUPO | ${C.magenta}${msg.key.remoteJid} | ${C.green}${groupName} | ${fromClean} | ${msg.pushName} | ${C.white}${texto}${C.reset}`;
  }
  return `${stamp} ${C.yellow}PV | ${C.magenta}${fromClean} | ${C.green}${msg.pushName} | ${C.white}${texto}${C.reset}`;
}

// ============================================================
// PROCESSAMENTO DE VOTOS DE ENQUETE VIA pollUpdateMessage
// (Método principal — captura em messages.upsert)
// ============================================================
async function processarPollUpdateMessage(msg, botJid) {
  const pollUpdateMessage = msg.message?.pollUpdateMessage;
  if (!pollUpdateMessage) return;

  const pollCreationKey = pollUpdateMessage.pollCreationMessageKey;
  if (!pollCreationKey?.id) {
    console.log("⚠️ [LEILÃO] pollUpdateMessage sem pollCreationMessageKey");
    return;
  }

  const pollMsgId = pollCreationKey.id;
  const groupJid = pollCreationKey.remoteJid || msg.key.remoteJid;
  const voterJidRaw = msg.key.participant || msg.key.remoteJid;

  console.log(`🗳️ [LEILÃO] Voto detectado! PollID: ${pollMsgId}, Grupo: ${groupJid}, Votante: ${voterJidRaw}`);

  // Verificar se há sessão ativa com essa enquete
  if (!temSessaoAtiva(groupJid)) {
    console.log(`⚠️ [LEILÃO] Voto ignorado: sem sessão ativa no grupo ${groupJid}`);
    return;
  }

  const sessao = getSessaoAtiva(groupJid);
  if (!sessao?.enquetes?.[pollMsgId]) {
    console.log(`⚠️ [LEILÃO] Voto ignorado: enquete ${pollMsgId} não registrada na sessão`);
    return;
  }

  // Buscar a mensagem original da poll no store
  const pollCreationMsg = getStoredMessage(pollCreationKey);
  if (!pollCreationMsg) {
    console.log("⚠️ [LEILÃO] Poll original não encontrada no store — usando fallback de hashes");
    await processarVotoFallbackDireto(groupJid, pollMsgId, voterJidRaw, pollUpdateMessage, sessao);
    return;
  }

  // Obter o messageSecret (pollEncKey) — pode estar em vários lugares
  const pollEncKey = pollCreationMsg.message?.messageContextInfo?.messageSecret
    || pollCreationMsg.messageContextInfo?.messageSecret
    || pollCreationMsg.message?.pollCreationMessage?.messageSecret
    || pollCreationMsg.message?.pollCreationMessageV2?.messageSecret
    || pollCreationMsg.message?.pollCreationMessageV3?.messageSecret;

  if (!pollEncKey) {
    console.log("⚠️ [LEILÃO] messageSecret não encontrado — usando fallback de hashes");
    console.log("🔍 [DEBUG] Estrutura da poll armazenada:", JSON.stringify(Object.keys(pollCreationMsg), null, 2));
    if (pollCreationMsg.message) {
      console.log("🔍 [DEBUG] Keys em msg.message:", JSON.stringify(Object.keys(pollCreationMsg.message), null, 2));
    }
    await processarVotoFallbackDireto(groupJid, pollMsgId, voterJidRaw, pollUpdateMessage, sessao);
    return;
  }

  // Tentar descriptografar o voto
  if (decryptPollVote && pollUpdateMessage.vote) {
    const decrypted = await tentarDecryptPollVote(
      pollUpdateMessage.vote,
      pollMsgId,
      pollEncKey,
      botJid,
      voterJidRaw,
      pollCreationKey
    );

    if (decrypted) {
      // Mapear os hashes descriptografados para as opções
      const enquete = sessao.enquetes[pollMsgId];
      const selectedOptions = decrypted.selectedOptions || [];

      if (selectedOptions.length === 0) {
        // Voto removido
        registrarVotoFallback(groupJid, pollMsgId, voterJidRaw, []);
        return;
      }

      // Converter hashes descriptografados para texto das opções
      for (const optHash of selectedOptions) {
        const hashHex = Buffer.isBuffer(optHash)
          ? optHash.toString("hex")
          : Buffer.from(optHash).toString("hex");

        for (const opcao of enquete.opcoes) {
          if (opcao.hash.toLowerCase() === hashHex.toLowerCase()) {
            console.log(`✅ [LEILÃO] Voto descriptografado: ${voterJidRaw} votou em "${opcao.texto}"`);
            registrarVotoFallback(groupJid, pollMsgId, voterJidRaw, [opcao.hash]);
            return;
          }
        }
      }

      // Se não encontrou match, registra com hash bruto
      console.log(`⚠️ [LEILÃO] Hash descriptografado não mapeado, usando fallback`);
      const hashes = selectedOptions.map(h => Buffer.isBuffer(h) ? h.toString("hex") : Buffer.from(h).toString("hex"));
      registrarVotoFallback(groupJid, pollMsgId, voterJidRaw, hashes);
      return;
    }
  }

  // Fallback: usar hashes brutos
  await processarVotoFallbackDireto(groupJid, pollMsgId, voterJidRaw, pollUpdateMessage, sessao);
}

/**
 * Tenta descriptografar o voto com múltiplas combinações de JID (LID vs PN).
 */
async function tentarDecryptPollVote(vote, pollMsgId, pollEncKey, botJid, voterJidRaw, pollCreationKey) {
  if (!decryptPollVote || !vote?.encPayload || !vote?.encIv) {
    console.log("⚠️ [LEILÃO] decryptPollVote indisponível ou vote sem encPayload/encIv");
    return null;
  }

  // Preparar candidatos de JID
  const botJidNormalized = jidNormalizedUser(botJid);
  const voterJidNormalized = jidNormalizedUser(voterJidRaw);

  // O criador da poll é o bot (fromMe na criação)
  const pollCreatorJid = pollCreationKey.fromMe ? botJidNormalized : jidNormalizedUser(pollCreationKey.participant || pollCreationKey.remoteJid);

  // Combinações a tentar (LID para creator, PN para voter é o mais comum)
  const creatorCandidates = [pollCreatorJid, botJidNormalized].filter(Boolean);
  const voterCandidates = [voterJidNormalized, voterJidRaw].filter(Boolean);

  // Dedupe
  const uniqueCreators = [...new Set(creatorCandidates)];
  const uniqueVoters = [...new Set(voterCandidates)];

  console.log(`🔑 [LEILÃO] Tentando decryption com ${uniqueCreators.length} creators x ${uniqueVoters.length} voters`);

  for (const creatorJid of uniqueCreators) {
    for (const voterJid of uniqueVoters) {
      try {
        const decrypted = decryptPollVote(vote, {
          pollCreatorJid: creatorJid,
          pollMsgId,
          pollEncKey,
          voterJid,
        });

        if (decrypted && decrypted.selectedOptions) {
          console.log(`✅ [LEILÃO] Decryption bem-sucedida com creator=${creatorJid}, voter=${voterJid}`);
          return decrypted;
        }
      } catch (e) {
        console.log(`🔄 [LEILÃO] Decryption falhou com creator=${creatorJid}, voter=${voterJid}: ${e.message}`);
        continue;
      }
    }
  }

  console.log("⚠️ [LEILÃO] Todas as tentativas de decryption falharam");
  return null;
}

/**
 * Processa voto usando fallback direto com hashes brutos do pollUpdateMessage.
 */
async function processarVotoFallbackDireto(groupJid, pollMsgId, voterJid, pollUpdateMessage, sessao) {
  const vote = pollUpdateMessage.vote;

  if (!vote || !vote.selectedOptions || vote.selectedOptions.length === 0) {
    console.log(`🗑️ [LEILÃO] Voto removido: ${voterJid}`);
    registrarVotoFallback(groupJid, pollMsgId, voterJid, []);
    return;
  }

  const enquete = sessao.enquetes[pollMsgId];
  const selectedHashes = vote.selectedOptions.map((opt) => {
    if (Buffer.isBuffer(opt)) return opt.toString("hex");
    if (opt instanceof Uint8Array) return Buffer.from(opt).toString("hex");
    if (typeof opt === "string") return opt;
    return String(opt);
  });

  console.log(`🔄 [LEILÃO] Fallback: hashes recebidos = ${selectedHashes.join(", ")}`);
  console.log(`🔄 [LEILÃO] Hashes esperados: ${enquete.opcoes.map(o => o.hash).join(", ")}`);

  let matched = false;
  for (const hashRecebido of selectedHashes) {
    for (const opcao of enquete.opcoes) {
      if (
        opcao.hash.toLowerCase() === hashRecebido.toLowerCase() ||
        opcao.hash.toLowerCase().startsWith(hashRecebido.toLowerCase()) ||
        hashRecebido.toLowerCase().startsWith(opcao.hash.toLowerCase())
      ) {
        console.log(`✅ [LEILÃO] Fallback match: "${opcao.texto}" (hash: ${opcao.hash})`);
        registrarVotoFallback(groupJid, pollMsgId, voterJid, [opcao.hash]);
        matched = true;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    console.log(`⚠️ [LEILÃO] Fallback sem match direto, registrando hash bruto`);
    registrarVotoFallback(groupJid, pollMsgId, voterJid, selectedHashes);
  }
}

// ============================================================
// PROCESSAMENTO DE VOTOS VIA messages.update (fallback legado)
// ============================================================
async function processarVotoEnqueteUpdate(update) {
  const pollCreationKey = update.key;
  const pollUpdates = update.update.pollUpdates;

  if (!pollCreationKey || !pollUpdates) return;

  const pollMsgId = pollCreationKey.id;
  const groupJid = pollCreationKey.remoteJid;

  console.log(`🗳️ [LEILÃO] messages.update detectado! PollID: ${pollMsgId}, Grupo: ${groupJid}`);

  if (getAggregateVotesInPollMessage) {
    try {
      const pollCreationMsg = getStoredMessage(pollCreationKey);

      if (pollCreationMsg) {
        const votes = getAggregateVotesInPollMessage({
          message: pollCreationMsg.message || pollCreationMsg,
          pollUpdates: pollUpdates,
        });

        if (votes && Object.keys(votes).length > 0) {
          console.log("✅ [LEILÃO] Votos agregados via messages.update:", JSON.stringify(votes));
          registrarVotosAgregados(groupJid, pollMsgId, votes);
          return;
        }
      }
    } catch (e) {
      console.log("⚠️ [LEILÃO] Erro na agregação via messages.update:", e.message);
    }
  }

  console.log("🔄 [LEILÃO] Usando fallback de hashes em messages.update...");

  for (const pollUpdate of pollUpdates) {
    const voterJid = pollUpdate.pollUpdateMessageKey?.participant
      || pollUpdate.pollUpdateMessageKey?.remoteJid
      || update.key.participant
      || "unknown";

    const vote = pollUpdate.vote;

    if (vote && vote.selectedOptions && vote.selectedOptions.length > 0) {
      const selectedHashes = vote.selectedOptions.map((opt) => {
        if (Buffer.isBuffer(opt)) return opt.toString("hex");
        if (opt instanceof Uint8Array) return Buffer.from(opt).toString("hex");
        if (typeof opt === "string") return opt;
        return String(opt);
      });

      registrarVotoFallback(groupJid, pollMsgId, voterJid, selectedHashes);
    } else {
      registrarVotoFallback(groupJid, pollMsgId, voterJid, []);
    }
  }
}

// ============================================================
// INICIALIZAÇÃO DO BOT
// ============================================================
async function startBot_Unique01() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ["Ferdinando", "Chrome", "1.0.0"],
    // getMessage é ESSENCIAL para descriptografar votos de enquetes
    getMessage: async (key) => {
      const msg = getStoredMessage(key);
      if (msg) {
        return msg.message || msg;
      }
      return undefined;
    },
  });

  globalThis.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") {
      console.log(C.green + "🔥 Ferdinando conectado e pronto!" + C.reset);
      console.log(C.cyan + `📱 Bot JID: ${sock.user?.id}` + C.reset);
    }
    if (connection === "close") {
      console.log(C.red + "❌ Conexão fechada. Reconectando..." + C.reset);
      setTimeout(() => startBot_Unique01(), 1000);
    }
  });

  // Evento de entrada no grupo
  sock.ev.on("group-participants.update", async (update) => {
    if (update.action !== "add") return;
    const grupoId = update.id;

    for (const usuario of update.participants) {
      try {
        const numero = usuario.replace(/@.*/, "");

        const banDetectado = await banCheckEntrada_Unique01(sock, grupoId, usuario);
        if (banDetectado) continue;

        const bvConfig = await lerBV(grupoId);
        if (!bvConfig || !bvConfig.ativo) continue;

        await sock.sendMessage(grupoId, { text: `👋 Olá @${numero}!`, mentions: [usuario] });
        await new Promise((r) => setTimeout(r, 500));
        await sock.sendMessage(grupoId, { text: bvConfig.mensagem, mentions: [usuario] });
      } catch (e) {}
    }
  });

  // ============================================================
  // CAPTURA DE VOTOS VIA messages.update (fallback — pode não disparar)
  // ============================================================
  sock.ev.on("messages.update", async (updates) => {
    for (const update of updates) {
      if (update.update?.pollUpdates) {
        try {
          await processarVotoEnqueteUpdate(update);
        } catch (e) {
          console.error("❌ [LEILÃO] Erro ao processar voto via messages.update:", e.message);
        }
      }
    }
  });

  // ============================================================
  // EVENTO DE MENSAGENS (messages.upsert) — PRINCIPAL PARA VOTOS
  // ============================================================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        await processarMensagem(msg, sock, type);
      } catch (e) {
        console.error("❌ Erro ao processar mensagem:", e.message);
      }
    }
  });
}

// ============================================================
// PROCESSAMENTO DE CADA MENSAGEM
// ============================================================
async function processarMensagem(msg, sock, upsertType) {
  // DEBUG: Logar TODAS as mensagens que chegam, incluindo as sem msg.message
  const msgKeys = msg ? Object.keys(msg) : [];
  const messageKeys = msg?.message ? Object.keys(msg.message) : [];

  // Detectar pollUpdateMessage ANTES de qualquer filtro
  // O pollUpdateMessage pode estar em msg.message ou pode ser que msg.message
  // não exista e o dado esteja em outro lugar
  const hasPollUpdate = msg?.message?.pollUpdateMessage
    || msg?.message?.encReactionMessage // pode vir encapsulado
    || messageKeys.some(k => k.toLowerCase().includes("poll"));

  if (hasPollUpdate) {
    console.log(`🔍 [DEBUG-POLL] Mensagem com conteúdo de poll detectada!`);
    console.log(`🔍 [DEBUG-POLL] msg.key:`, JSON.stringify(msg.key));
    console.log(`🔍 [DEBUG-POLL] messageKeys:`, JSON.stringify(messageKeys));
    console.log(`🔍 [DEBUG-POLL] upsertType: ${upsertType}`);
  }

  if (!msg?.message) {
    // Mesmo sem msg.message, verificar se é um messageStubType relevante
    if (msg?.messageStubType) {
      // Alguns votos podem chegar como stub
      console.log(`🔍 [DEBUG] Mensagem sem .message mas com stubType: ${msg.messageStubType}`);
    }
    return;
  }

  const jid = msg.key.remoteJid;
  const isGroup = jid?.endsWith("@g.us");

  // ARMAZENAR TODAS AS MENSAGENS NO STORE (para decryption de votos)
  storeMessage(msg);

  // ============================================================
  // DETECÇÃO DE VOTO EM ENQUETE (pollUpdateMessage)
  // Este é o caminho PRINCIPAL para captura de votos no Baileys 6.7.x
  // ============================================================
  if (msg.message.pollUpdateMessage) {
    console.log(`🗳️ [LEILÃO] pollUpdateMessage detectado no messages.upsert!`);
    console.log(`🗳️ [LEILÃO] De: ${msg.key.participant || msg.key.remoteJid}`);
    console.log(`🗳️ [LEILÃO] PollCreationKey:`, JSON.stringify(msg.message.pollUpdateMessage.pollCreationMessageKey));
    try {
      await processarPollUpdateMessage(msg, sock.user?.id || "");
    } catch (e) {
      console.error("❌ [LEILÃO] Erro ao processar pollUpdateMessage:", e.message);
      console.error(e.stack);
    }
    // Não retorna — pode haver outros processamentos
  }

  // DETECÇÃO DE ENQUETE CRIADA (pelo bot ou externamente)
  const pollCreation = msg.message.pollCreationMessage ||
    msg.message.pollCreationMessageV2 ||
    msg.message.pollCreationMessageV3;

  if (pollCreation && isGroup && temSessaoAtiva(jid)) {
    if (!msg.key.fromMe) {
      console.log(`📝 [LEILÃO] Enquete externa detectada durante sessão ativa: ${pollCreation.name}`);
      const pollName = pollCreation.name;
      const options = pollCreation.options.map((o) => o.optionName);
      registrarEnquete(jid, msg.key.id, pollName, options);
    } else {
      console.log(`📝 [LEILÃO] Poll do bot armazenada no store: ${pollCreation.name} (ID: ${msg.key.id})`);
    }
  }

  // Ignorar mensagens do próprio bot para processamento de comandos
  if (msg.key.fromMe) return;

  // Ignorar pollUpdateMessage para log/IA (já processado acima)
  if (msg.message.pollUpdateMessage) return;

  const texto = msg.message.conversation || msg.message.extendedTextMessage?.text ||
    (msg.message.imageMessage ? "[Imagem]" :
      pollCreation ? `[Enquete: ${pollCreation.name}]` :
        "[Mídia]");
  
  const rawUser = msg.key.participant || msg.key.remoteJid;
  const fromClean = rawUser.replace(/\D/g, "").slice(-15);

  let groupName = "";
  if (isGroup) {
    try {
      const meta = await sock.groupMetadata(jid);
      groupName = meta.subject;
      await atualizarGrupo_Unique03(sock, jid);
    } catch { groupName = "Grupo"; }
  }

  // Log de console otimizado
  console.log(formatLog(msg, texto, isGroup, groupName, fromClean));

  // Salva log em arquivo
  botLoggerRegisterEvent_Unique01(msg);

  // Verificador automático de anúncios (links, imagens, cards)
  if (isGroup) {
    try {
      const bloqueio = await verificarAnuncioAuto(msg, sock, fromClean);
      if (bloqueio) {
        try {
          await sock.sendMessage(jid, { delete: msg.key });
        } catch {}
        const rawUser2 = msg.key.participant || msg.key.remoteJid;
        await sock.sendMessage(jid, {
          text: bloqueio,
          mentions: [rawUser2]
        });
        return;
      }
    } catch (e) {
      console.error("Erro verificarAnuncioAuto:", e.message);
    }
  }

  // Dispatcher de comandos
  if (texto.startsWith("!")) {
    try {
      const rawCmds = fs.readFileSync(path.resolve("src/data/comandos.json"), "utf8");
      const comandosJSON = JSON.parse(rawCmds);
      const cmd = texto.split(" ")[0];
      const cfg = comandosJSON[cmd];

      if (cfg) {
        const meta = isGroup ? await sock.groupMetadata(jid) : null;
        const isAdmin = isGroup ? meta.participants.some(p => p.id.replace(/@.*/, "") === fromClean && (p.admin === "admin" || p.admin === "superadmin")) : false;
        const isRoot = fromClean === ROOT;

        if (cfg.admin && !isAdmin && !isRoot) {
          await sock.sendMessage(jid, { text: "Sem permissão." });
          return;
        }

        const modulo = await import(cfg.file + `?v=${Date.now()}`);
        const fn = modulo[cfg.function];
        const args = texto.split(" ").slice(1);
        const dados = await fn(msg, sock, fromClean, args);

        // Se o comando retornou null, não envia nada (ex: enquete já envia a poll)
        if (dados === null || dados === undefined) return;

        const resposta = await clawBrainProcess_Unique01({ tipo: "comando", comando: cmd.replace("!", ""), dados });
        if (resposta) await sock.sendMessage(jid, { text: String(resposta) });
        return;
      }
    } catch (e) {
      console.error("Erro ao processar comando:", e.message);
    }
  }

  // IA Normal: apenas em PV
  if (!isGroup) {
    const resposta = await clawBrainProcess_Unique01(msg);
    if (resposta) await sock.sendMessage(jid, { text: String(resposta) });
  }
}

startBot_Unique01();

// Sistema de Ações Agendadas
setInterval(async () => {
  try {
    const agora = new Date();
    const REM_PATH = path.resolve("src/data/reminders.json");
    if (fs.existsSync(REM_PATH)) {
      const dbRem = JSON.parse(fs.readFileSync(REM_PATH, "utf8"));
      const gatilhos = dbRem.lembretes.filter(l => l.ativo !== false && new Date(l.quando) <= agora);
      for (const l of gatilhos) {
        const { enviar_lembrete } = await import("../commands/enviar-lembrete.js");
        await enviar_lembrete(l, globalThis.sock);
      }
    }
  } catch (e) {}
}, 10000);
