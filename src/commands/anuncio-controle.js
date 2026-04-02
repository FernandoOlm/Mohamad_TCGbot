// ============================================================
// anuncio-controle.js — Sistema de Controle de Anúncios
// Ferdinando IA
// ============================================================
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { xerifeAtivo } from "./xerife.js";

// ============================================================
// PATHS
// ============================================================
const CONFIG_PATH = path.resolve("src/data/anuncio-config.json");
const CONTADORES_PATH = path.resolve("src/data/anuncio-contadores.json");
const AUTH_PATH = path.resolve("src/data/auth/allowed.json");

// ============================================================
// DIAS DA SEMANA — normalização
// ============================================================
const DIAS_MAP = {
  domingo: 0, dom: 0,
  segunda: 1, "segunda-feira": 1,
  terca: 2, terça: 2, "terça-feira": 2, "terca-feira": 2,
  quarta: 3, "quarta-feira": 3,
  quinta: 4, "quinta-feira": 4,
  sexta: 5, "sexta-feira": 5,
  sabado: 6, sábado: 6,
};

const DIAS_NOME = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];

function normalizarDia(str) {
  const s = str.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const found = Object.keys(DIAS_MAP).find(k =>
    k.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === s
  );
  return found || null;
}

// ============================================================
// LOAD / SAVE CONFIG
// ============================================================
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(db) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(db, null, 2));
}

// ============================================================
// LOAD / SAVE CONTADORES DIÁRIOS
// ============================================================
function loadContadores() {
  if (!fs.existsSync(CONTADORES_PATH)) {
    fs.writeFileSync(CONTADORES_PATH, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(CONTADORES_PATH, "utf8"));
}

function saveContadores(db) {
  fs.writeFileSync(CONTADORES_PATH, JSON.stringify(db, null, 2));
}

// ============================================================
// LOAD AUTH (vendedores cadastrados via !autorizar)
// ============================================================
function loadAuth() {
  if (!fs.existsSync(AUTH_PATH)) return { grupos: {} };
  return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
}

function isCadastrado(groupId, userId) {
  const auth = loadAuth();
  const autorizados = auth.grupos?.[groupId]?.autorizados || [];
  return autorizados.some(a => a.replace(/\D/g, "").slice(-15) === userId);
}

// ============================================================
// VERIFICAR JANELA DE HORÁRIO
// ============================================================
function isWithinAllowedSchedule(groupId, now) {
  const config = loadConfig();
  const cfg = config[groupId];
  if (!cfg || !cfg.schedule || cfg.schedule.length === 0) return true;

  const diaSemana = now.getDay();
  const horaAtual = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  for (const janela of cfg.schedule) {
    const diasNums = janela.days.map(d => DIAS_MAP[d]).filter(n => n !== undefined);
    if (!diasNums.includes(diaSemana)) continue;
    if (horaAtual >= janela.start && horaAtual <= janela.end) return true;
  }
  return false;
}

// ============================================================
// CONTROLE DIÁRIO
// ============================================================
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function hasReachedDailyLimit(userId, groupId) {
  const config = loadConfig();
  const maxPerDay = config[groupId]?.maxPerDay ?? 1;
  const contadores = loadContadores();
  const hoje = getTodayKey();
  return (contadores?.[groupId]?.[userId]?.[hoje] || 0) >= maxPerDay;
}

function incrementAdCount(userId, groupId) {
  const contadores = loadContadores();
  const hoje = getTodayKey();
  if (!contadores[groupId]) contadores[groupId] = {};
  if (!contadores[groupId][userId]) contadores[groupId][userId] = {};
  // Limpa dias antigos
  for (const k of Object.keys(contadores[groupId][userId])) {
    if (k !== hoje) delete contadores[groupId][userId][k];
  }
  contadores[groupId][userId][hoje] = (contadores[groupId][userId][hoje] || 0) + 1;
  saveContadores(contadores);
  return contadores[groupId][userId][hoje];
}

// ============================================================
// ANTI-DUPLICATA (hash da mensagem — anti-malandro)
// ============================================================
const hashCache = {};

function hashMensagem(texto) {
  const norm = texto.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim();
  return crypto.createHash("md5").update(norm).digest("hex");
}

function isDuplicada(groupId, userId, texto) {
  const h = hashMensagem(texto);
  if (!hashCache[groupId]) hashCache[groupId] = {};
  if (!hashCache[groupId][userId]) hashCache[groupId][userId] = [];
  const lista = hashCache[groupId][userId];
  if (lista.includes(h)) return true;
  lista.push(h);
  if (lista.length > 10) lista.shift();
  return false;
}

// ============================================================
// DETECTOR DE ANÚNCIO — detecta APENAS links e cards de grupo
// Imagens normais são LIBERADAS (pessoas procurando cartas, etc.)
// ============================================================
function isAnuncio(msg) {
  const m = msg.message;
  if (!m) return false;

  // Card de convite de grupo — sempre bloqueia
  if (m.groupInviteMessage) return true;

  // Texto com link (http/https, wa.me, chat.whatsapp.com)
  const texto = m.conversation || m.extendedTextMessage?.text || "";
  if (/https?:\/\/|wa\.me\/|chat\.whatsapp\.com/i.test(texto)) return true;

  // Imagem com legenda contendo link
  const legenda = m.imageMessage?.caption || "";
  if (/https?:\/\/|wa\.me\/|chat\.whatsapp\.com/i.test(legenda)) return true;

  // Imagem simples (sem link na legenda) → LIBERA
  return false;
}

// ============================================================
// VERIFICADOR AUTOMÁTICO — chamado pelo index.js para cada msg
// Retorna: null (não é anúncio ou passou), ou string com motivo do bloqueio
// ============================================================
export async function verificarAnuncioAuto(msg, sock, fromClean) {
  try {
    const groupId = msg.key.remoteJid;
    if (!groupId.endsWith("@g.us")) return null;

    const config = loadConfig();
    const cfg = config[groupId];

    // Controle não ativo neste grupo → ignora
    if (!cfg || !cfg.controleAtivo) return null;

    // Não é anúncio → ignora
    if (!isAnuncio(msg)) return null;

    // 1. Verifica cadastro
    if (!isCadastrado(groupId, fromClean)) {
      return `🚫 @${fromClean} não está cadastrado como vendedor.\n_Fale com um admin para ser autorizado._`;
    }

    // 2. Verifica dia/horário
    const agora = new Date();
    if (!isWithinAllowedSchedule(groupId, agora)) {
      const diaNome = DIAS_NOME[agora.getDay()];
      const horaAtual = `${String(agora.getHours()).padStart(2,"0")}:${String(agora.getMinutes()).padStart(2,"0")}`;
      // Monta lista de dias/horários permitidos
      let janelas = "";
      if (cfg.schedule?.length) {
        janelas = cfg.schedule.map(j => {
          const dias = j.days.map(d => {
            const idx = DIAS_MAP[d];
            return idx !== undefined ? DIAS_NOME[idx] : d;
          }).join("/");
          return `${dias}: ${j.start}–${j.end}`;
        }).join(" | ");
      }
      return `🚫 Fora do horário de anúncios.\n📅 Hoje é *${diaNome}*, ${horaAtual}.\n⏰ Permitido: ${janelas || "nenhum horário configurado"}`;
    }

    // 3. Verifica limite diário
    if (hasReachedDailyLimit(fromClean, groupId)) {
      const max = cfg.maxPerDay ?? 1;
      return `🚫 Limite diário atingido.\n📊 Máximo: *${max} anúncio(s)* por dia.`;
    }

    // 4. Anti-duplicata
    const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "";
    if (texto && isDuplicada(groupId, fromClean, texto)) {
      return `🚫 Anúncio duplicado detectado. Aguarde antes de reenviar o mesmo conteúdo.`;
    }

    // Tudo OK — incrementa contador e libera silenciosamente
    const count = incrementAdCount(fromClean, groupId);
    const max = cfg.maxPerDay ?? 1;
    console.log(`[ANUNCIO] ✅ ${fromClean} em ${groupId} — ${count}/${max}`);
    return null; // null = liberado, não bloqueia

  } catch (err) {
    console.error("[ANUNCIO] Erro no verificador:", err.message);
    return null; // em caso de erro, não bloqueia
  }
}

// ============================================================
// COMANDO: !ativar-controle
// ============================================================
export async function ativarControle(msg, sock, fromClean) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { texto: "❌ Apenas em grupos." };

  const config = loadConfig();
  if (!config[groupId]) config[groupId] = {};
  config[groupId].controleAtivo = true;
  if (!config[groupId].maxPerDay) config[groupId].maxPerDay = 1;
  if (!config[groupId].schedule) config[groupId].schedule = [];
  saveConfig(config);

  return { texto: "✅ Controle de anúncios *ATIVADO* neste grupo.\n\nAgora qualquer link ou imagem postada será validado automaticamente." };
}

// ============================================================
// COMANDO: !desativar-controle
// ============================================================
export async function desativarControle(msg, sock, fromClean) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { texto: "❌ Apenas em grupos." };

  const config = loadConfig();
  if (!config[groupId]) config[groupId] = {};
  config[groupId].controleAtivo = false;
  saveConfig(config);

  return { texto: "⚠️ Controle de anúncios *DESATIVADO*." };
}

// ============================================================
// COMANDO: !ver-anuncio-config
// ============================================================
export async function verAnuncioConfig(msg, sock, fromClean) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { texto: "❌ Apenas em grupos." };

  const config = loadConfig();
  const cfg = config[groupId];

  if (!cfg) return { texto: "⚠️ Nenhuma configuração definida ainda.\nUse *!ativar-controle* para começar." };

  const status = cfg.controleAtivo ? "✅ ATIVO" : "❌ DESATIVADO";
  const limite = cfg.maxPerDay ?? 1;

  let texto = `📢 *Configuração de anúncios*\n\n`;
  texto += `Status: *${status}*\n`;
  texto += `Limite diário: *${limite} anúncio(s) por vendedor*\n\n`;

  if (!cfg.schedule || cfg.schedule.length === 0) {
    texto += `🕒 Horários: *Sem restrição de horário*`;
  } else {
    texto += `🕒 *Janelas permitidas:*\n`;
    for (const j of cfg.schedule) {
      const diasNomes = j.days.map(d => {
        const idx = DIAS_MAP[d];
        return idx !== undefined ? DIAS_NOME[idx] : d;
      }).join(" / ");
      texto += `• ${diasNomes}: ${j.start} - ${j.end}\n`;
    }
  }

  return { texto: texto.trim() };
}

// ============================================================
// COMANDO: !config-anuncio <dias> <horaInicio> <horaFim>
// ============================================================
export async function configAnuncio(msg, sock, fromClean, args) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { texto: "❌ Apenas em grupos." };

  if (!args || args.length < 3) {
    return { texto: "❌ Uso: !config-anuncio <dias> <horaInicio> <horaFim>\nEx: !config-anuncio segunda,quarta 08:00 18:00" };
  }

  const diasStr = args[0];
  const horaInicio = args[1];
  const horaFim = args[2];

  const horaRegex = /^\d{2}:\d{2}$/;
  if (!horaRegex.test(horaInicio) || !horaRegex.test(horaFim)) {
    return { texto: "❌ Horário inválido. Use o formato HH:MM (ex: 08:00)" };
  }

  const diasRaw = diasStr.split(",");
  const diasNormalizados = [];
  for (const d of diasRaw) {
    const norm = normalizarDia(d);
    if (!norm) return { texto: `❌ Dia inválido: "${d}". Use: segunda, terca, quarta, quinta, sexta, sabado, domingo` };
    diasNormalizados.push(norm);
  }

  const config = loadConfig();
  if (!config[groupId]) config[groupId] = { controleAtivo: false, schedule: [], maxPerDay: 1 };
  if (!config[groupId].schedule) config[groupId].schedule = [];

  // Remove janela com os mesmos dias para substituir
  config[groupId].schedule = config[groupId].schedule.filter(j =>
    !j.days.some(d => diasNormalizados.includes(d))
  );

  config[groupId].schedule.push({ days: diasNormalizados, start: horaInicio, end: horaFim });
  saveConfig(config);

  const diasNomes = diasNormalizados.map(d => {
    const idx = DIAS_MAP[d];
    return idx !== undefined ? DIAS_NOME[idx] : d;
  }).join(" / ");

  return { texto: `✅ Horário de anúncios configurado:\n\n📅 ${diasNomes}: ${horaInicio} - ${horaFim}` };
}

// ============================================================
// COMANDO: !limite-anuncio <N>
// ============================================================
export async function limiteAnuncio(msg, sock, fromClean, args) {
  const groupId = msg.key.remoteJid;
  if (!groupId.endsWith("@g.us")) return { texto: "❌ Apenas em grupos." };

  const n = parseInt(args?.[0]);
  if (isNaN(n) || n < 1) return { texto: "❌ Uso: !limite-anuncio <número>\nEx: !limite-anuncio 2" };

  const config = loadConfig();
  if (!config[groupId]) config[groupId] = { controleAtivo: false, schedule: [], maxPerDay: 1 };
  config[groupId].maxPerDay = n;
  saveConfig(config);

  return { texto: `✅ Limite diário definido: *${n} anúncio(s)* por vendedor.` };
}

// ============================================================
// FIM
// ============================================================
