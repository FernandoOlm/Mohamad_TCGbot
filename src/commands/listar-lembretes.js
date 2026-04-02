//////////////////////////////
// INÍCIO cmdListarLembretes
// Dispatcher chama: fn(msg, sock, fromClean, args)
// Retorna dados para o clawBrain processar (não envia direto)

import fs from "fs";
import path from "path";

export async function cmdListarLembretes(msg, sock, fromClean, args) {
  try {
    const jid = msg.key.remoteJid;

    // Carregar JSON
    const filePath = path.resolve("src/data/reminders.json");

    if (!fs.existsSync(filePath)) {
      return { resposta: "📝 Nenhum lembrete ativo para este grupo." };
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const db = JSON.parse(raw);

    // Filtrar por grupo
    const lista = db.lembretes.filter(l => l.grupo === jid);

    if (lista.length === 0) {
      return { resposta: "📝 Nenhum lembrete ativo para este grupo." };
    }

    // Montar resposta
    let txt = "📌 *Lembretes deste grupo:*\n\n";

    for (const item of lista) {
      const quandoBR = new Date(item.quando).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      });

      const status = item.ativo === false ? "⏸️" : "▶️";
      const statusTxt = item.ativo === false ? " _(desativado)_" : "";

      txt += `${status} *ID:* ${item.id}${statusTxt}\n`;
      txt += `🕒 ${quandoBR}\n`;
      txt += `💬 ${item.texto}\n`;
      txt += `🔁 Repetição: ${item.repeat || "nenhuma"}\n`;
      if (item.tipoEspecial) txt += `⚙️ Tipo especial: ${item.tipoEspecial}\n`;
      txt += `----------------------------------\n`;
    }

    return { resposta: txt };

  } catch (e) {
    console.error("Erro listar lembretes:", e);
    return { resposta: "❌ Erro ao listar lembretes." };
  }
}
// FIM cmdListarLembretes
//////////////////////////////
