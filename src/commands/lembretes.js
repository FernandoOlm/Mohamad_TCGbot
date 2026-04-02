/* ===============================
   SISTEMA DE LEMBRETES — CORRIGIDO
   =============================== */

import fs from "fs";
import path from "path";

// =======================================
// PATH DO reminders.json
// =======================================
const REMINDERS_PATH = path.resolve("src/data/reminders.json");

// =======================================
// GARANTE ARQUIVO EXISTE
// =======================================
function ensure() {
  if (!fs.existsSync(REMINDERS_PATH)) {
    fs.writeFileSync(
      REMINDERS_PATH,
      JSON.stringify({ lembretes: [] }, null, 2)
    );
  }
}

// =======================================
// LOAD / SAVE / NEXT ID
// =======================================
function loadReminders() {
  ensure();
  return JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf-8"));
}

function saveReminders(db) {
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
}

function nextId(db) {
  if (db.lembretes.length === 0) return 1;
  return Math.max(...db.lembretes.map(l => l.id)) + 1;
}

// =======================================================
// COMANDO PRINCIPAL — INTERPRETA !lembrete
// Formato: !lembrete DD/MM/AAAA HH:MM [D|S|M] mensagem
// =======================================================
export async function comandoLembrete(msg, fromClean, textoOriginal) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { resposta: "Esse comando só funciona em grupos." };
  }

  const p = textoOriginal.trim().split(" ");

  if (p.length < 3) {
    return {
      resposta:
"Formato inválido.\nUse:\n!lembrete DD/MM/AAAA HH:MM [D|S|M] Mensagem"
    };
  }

  const dataStr = p[0];
  const horaStr = p[1];

  // Identifica repetição
  let repeat = null;
  let mensagem = "";

  if (["D", "S", "M"].includes(p[2].toUpperCase())) {
    const tipo = p[2].toUpperCase();
    repeat =
      tipo === "D" ? "daily" :
      tipo === "S" ? "weekly" :
      "monthly";

    mensagem = p.slice(3).join(" ");
  } else {
    mensagem = p.slice(2).join(" ");
  }

  // Converte data
  const [dd, mm, aa] = dataStr.split("/");
  const [hh, min] = horaStr.split(":");
  const dt = new Date(`${aa}-${mm}-${dd}T${hh}:${min}:00`);

  if (isNaN(dt.getTime())) {
    return { resposta: "Data ou hora inválida." };
  }

  // Salva lembrete
  const db = loadReminders();
  const id = nextId(db);

  db.lembretes.push({
    id,
    grupo: jid,
    autor: fromClean,
    quando: dt.toISOString(),
    texto: mensagem,
    repeat
  });

  saveReminders(db);

  // ----------------------------
  // Texto da repetição
  // ----------------------------
  const repTxt =
    repeat === "daily"   ? "Diário" :
    repeat === "weekly"  ? "Semanal" :
    repeat === "monthly" ? "Mensal" :
    "Único";

  // ----------------------------
  // Resumo inteligente
  // ----------------------------
  let resumo = "";

  if (repeat === "daily") {
    resumo = `🔁 Esse lembrete será enviado *todo dia às ${horaStr}*.`;
  }
  else if (repeat === "weekly") {
    const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const diaSemana = dias[new Date(`${aa}-${mm}-${dd}`).getDay()];
    resumo = `🔁 Esse lembrete será enviado *toda semana na ${diaSemana} às ${horaStr}*.`;
  }
  else if (repeat === "monthly") {
    resumo = `🔁 Esse lembrete será enviado *todo mês no dia ${dd} às ${horaStr}*.`;
  }
  else {
    resumo = `📌 Esse lembrete será enviado *uma única vez* na data informada.`;
  }

  // ----------------------------
  // Resposta final
  // ----------------------------
  return {
    resposta:
`✅ *Lembrete criado!* 

📅 *Data:* ${dataStr}
⏰ *Hora:* ${horaStr}
🔁 *Repetição:* ${repTxt}

📝 *Mensagem:* ${mensagem}

${resumo}`
  };
}

// =======================================================
// ATALHO INTERNO — Cria lembrete recorrente sem data
// Formato: HH:MM mensagem
// Gera data de hoje e aplica repetição
// =======================================================
function criarLembreteRecorrente(msg, fromClean, textoOriginal, tipoRepeat) {
  const jid = msg.key.remoteJid;

  if (!jid.endsWith("@g.us")) {
    return { resposta: "Esse comando só funciona em grupos." };
  }

  const p = textoOriginal.trim().split(" ");

  if (p.length < 2) {
    const nomes = { daily: "diário", weekly: "semanal", monthly: "mensal" };
    return {
      resposta: `Formato inválido.\nUse: !lembrete-${nomes[tipoRepeat]} HH:MM Mensagem`
    };
  }

  const horaStr = p[0];
  const mensagem = p.slice(1).join(" ");

  // Valida formato HH:MM
  if (!horaStr.includes(":")) {
    return { resposta: "Hora inválida. Use o formato HH:MM." };
  }

  const [hh, min] = horaStr.split(":");
  if (isNaN(Number(hh)) || isNaN(Number(min))) {
    return { resposta: "Hora inválida. Use o formato HH:MM." };
  }

  // Gera data de hoje com o horário informado
  const agora = new Date();
  const dt = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), Number(hh), Number(min), 0);

  // Se o horário já passou hoje, agenda para amanhã
  if (dt <= agora) {
    dt.setDate(dt.getDate() + 1);
  }

  const db = loadReminders();
  const id = nextId(db);

  db.lembretes.push({
    id,
    grupo: jid,
    autor: fromClean,
    quando: dt.toISOString(),
    texto: mensagem,
    repeat: tipoRepeat
  });

  saveReminders(db);

  const nomes = { daily: "Diário", weekly: "Semanal", monthly: "Mensal" };
  const descricao = {
    daily: `*todo dia às ${horaStr}*`,
    weekly: `*toda semana às ${horaStr}*`,
    monthly: `*todo mês às ${horaStr}*`
  };

  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const aa = dt.getFullYear();

  return {
    resposta:
`✅ *Lembrete ${nomes[tipoRepeat]} criado!*

📅 *Início:* ${dd}/${mm}/${aa}
⏰ *Hora:* ${horaStr}
🔁 *Repetição:* ${nomes[tipoRepeat]}

📝 *Mensagem:* ${mensagem}

🔁 Esse lembrete será enviado ${descricao[tipoRepeat]}.`
  };
}

// =======================================================
// ROTA PRINCIPAL DO BOT → !lembrete
// Dispatcher chama: fn(msg, sock, fromClean, args)
// =======================================================
export async function cmdLembrete(msg, sock, fromClean, args) {
  const txt =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";

  const textoOriginal = txt.replace(/^!lembrete\s*/i, "").trim();

  return await comandoLembrete(msg, fromClean, textoOriginal);
}

// =======================================================
// ATALHOS — !lembrete-diario / semanal / mensal
// Dispatcher chama: fn(msg, sock, fromClean, args)
// =======================================================

export async function cmdLembreteDiario(msg, sock, fromClean, args) {
  const txt =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";
  const original = txt.replace(/^!lembrete-diario\s*/i, "").trim();
  return criarLembreteRecorrente(msg, fromClean, original, "daily");
}

export async function cmdLembreteSemanal(msg, sock, fromClean, args) {
  const txt =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";
  const original = txt.replace(/^!lembrete-semanal\s*/i, "").trim();
  return criarLembreteRecorrente(msg, fromClean, original, "weekly");
}

export async function cmdLembreteMensal(msg, sock, fromClean, args) {
  const txt =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";
  const original = txt.replace(/^!lembrete-mensal\s*/i, "").trim();
  return criarLembreteRecorrente(msg, fromClean, original, "monthly");
}

// =======================================================
// COMANDO !desativar-lembrete
// Dispatcher chama: fn(msg, sock, fromClean, args)
// Agora DESATIVA (marca ativo=false) ao invés de remover
// =======================================================
export async function cmdDesativarLembrete(msg, sock, fromClean, args) {
  const txt =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    "";

  const clean = txt.replace(/^!desativar-lembrete\s*/i, "").trim();
  const parsedArgs = clean.split(" ").filter(x => x.length > 0);
  const jid = msg.key.remoteJid;

  const db = loadReminders();

  // Sem ID → lista lembretes do grupo
  if (parsedArgs.length === 0) {
    const lista = db.lembretes.filter(l => l.grupo === jid);

    if (lista.length === 0) {
      return { resposta: "📝 Nenhum lembrete cadastrado neste grupo." };
    }

    const linhas = lista.map(l => {
      const status = l.ativo === false ? "⏸️" : "▶️";
      return `${status} *ID ${l.id}* — ${l.texto} (${l.repeat || "único"})`;
    });

    return {
      resposta: `📋 *Lembretes deste grupo:*\n\n${linhas.join("\n")}\n\nPara desativar, use: !desativar-lembrete [ID]`
    };
  }

  const id = Number(parsedArgs[0]);
  if (isNaN(id)) {
    return { resposta: "❌ ID inválido. Use: !desativar-lembrete [ID]" };
  }

  const lembrete = db.lembretes.find(l => l.id === id && l.grupo === jid);

  if (!lembrete) {
    return { resposta: `❌ Lembrete ID *${id}* não encontrado neste grupo.` };
  }

  if (lembrete.ativo === false) {
    return { resposta: `⚠️ Lembrete ID *${id}* já está desativado.` };
  }

  lembrete.ativo = false;
  saveReminders(db);

  return {
    resposta: `⏸️ Lembrete ID *${id}* desativado.\n\n📝 "${lembrete.texto}"\n\nPara reativar, use: !ativar-lembrete ${id}`
  };
}
