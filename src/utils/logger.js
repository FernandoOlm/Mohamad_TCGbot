// ===== INICIO: LOGGER OTIMIZADO (VPS FRIENDLY) =====

import fs from "fs";
import path from "path";

// ===== INICIO: BASE PATH =====
const BASE_PATH = path.resolve("src/data");
// ===== FIM =====

// ===== INICIO: GARANTE PASTAS =====
function garantirPastas_Unique02() {
  const pastas = [
    `${BASE_PATH}/logs/messages`,
  ];

  pastas.forEach((p) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
}
// ===== FIM =====

// ===== INICIO: LOGGER DE MENSAGEM OTIMIZADO =====
export const botLoggerV3_Message_Unique07 = async (msg) => {
  try {
    // Apenas loga se for comando ou se você quiser manter um rastro mínimo
    const texto =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      (msg.message?.imageMessage ? "[IMAGEM]" : null) ||
      (msg.message?.videoMessage ? "[VÍDEO]" : null) ||
      (msg.message?.audioMessage ? "[ÁUDIO]" : null) ||
      null;

    if (!texto) return;

    // Otimização: Não baixar mídia, não salvar hashes complexos, não atualizar JSON de usuários
    // Isso economiza CPU, RAM e principalmente DISCO na sua VPS.

    garantirPastas_Unique02();
    const data = new Date().toISOString().slice(0, 10);
    const file = path.resolve(`${BASE_PATH}/logs/messages/${data}.log`);

    const isGroup = msg.key.remoteJid.endsWith("@g.us");
    const rawUser = msg.key.participant || msg.key.remoteJid;
    const userClean = rawUser.replace(/@.*/, "");

    const entry = {
      t: new Date().toISOString(),
      g: isGroup ? msg.key.remoteJid : "PV",
      u: userClean,
      n: msg.pushName || "User",
      m: texto
    };

    // Salva em formato compacto (uma linha por mensagem)
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");

  } catch (err) {
    // Silencioso para não poluir o console da VPS
  }
};
// ===== FIM =====

// ===== INICIO: COMPATIBILIDADE LEGADO =====
export const botLoggerRegisterEvent_Unique01 = botLoggerV3_Message_Unique07;
export const botLoggerV3_GroupEvent_Unique08 = () => {}; // Desativado para economizar espaço
// ===== FIM =====
