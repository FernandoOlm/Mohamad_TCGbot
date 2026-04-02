/* INÍCIO apagar-lembrete.js — CORRIGIDO */

import fs from "fs";
import path from "path";

// Dispatcher chama: fn(msg, sock, fromClean, args)
// Retorna dados para o clawBrain processar (não envia direto)
export async function cmdApagarLembrete(msg, sock, fromClean, args) {
  try {
    const jid = msg.key.remoteJid;

    // Validar args — args é o 4º parâmetro do dispatcher
    if (!args || !args[0] || isNaN(args[0])) {
      return { resposta: "❌ Use: !apagar-lembrete [ID]\n\nPara ver os IDs, use: !listar-lembretes" };
    }
    const id = Number(args[0]);

    // Carregar JSON
    const filePath = path.resolve("src/data/reminders.json");

    if (!fs.existsSync(filePath)) {
      return { resposta: "❌ Nenhum lembrete cadastrado." };
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const db = JSON.parse(raw);

    // Localizar — filtra por ID E por grupo (segurança)
    const lembrete = db.lembretes.find(l => l.id === id && l.grupo === jid);

    if (!lembrete) {
      return { resposta: `❌ Lembrete ID *${id}* não encontrado neste grupo.` };
    }

    const textoRemovido = lembrete.texto;

    // Remover
    db.lembretes = db.lembretes.filter(l => !(l.id === id && l.grupo === jid));
    fs.writeFileSync(filePath, JSON.stringify(db, null, 2));

    return {
      resposta: `🗑️ Lembrete ID *${id}* apagado!\n\n📝 "${textoRemovido}"`
    };

  } catch (err) {
    console.error("Erro ao apagar lembrete:", err);
    return { resposta: "❌ Erro ao apagar lembrete." };
  }
}

/* FIM apagar-lembrete.js */
