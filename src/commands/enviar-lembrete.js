// =========================================================
// COMANDO: enviar-lembrete — CORRIGIDO
// Lê reminders.json, dispara a mensagem e menciona todos
// Agora trata tipoEspecial (abrir_grupo, fechar_grupo)
// =========================================================

import fs from "fs";
import path from "path";
const REMINDERS_PATH = path.resolve("src/data/reminders.json");

// ---------------------------------------------------------
// FUNÇÃO PRINCIPAL
// ---------------------------------------------------------
export async function enviar_lembrete(lembrete, sock) {
  try {
    console.log("📢 Disparando lembrete ID:", lembrete.id);

    // Verifica se lembrete está desativado
    if (lembrete.ativo === false) {
      console.log(`⏸️ Lembrete ID ${lembrete.id} está desativado, ignorando.`);
      return false;
    }

    // ---------------------------------------------------------
    // TIPO ESPECIAL — abrir/fechar grupo
    // ---------------------------------------------------------
    if (lembrete.tipoEspecial === "abrir_grupo") {
      await sock.groupSettingUpdate(lembrete.grupo, "not_announcement");
      await sock.sendMessage(lembrete.grupo, {
        text: "🔓 Grupo aberto automaticamente!"
      });
      console.log(`✔ Grupo ${lembrete.grupo} aberto via agendamento`);
      atualizarRepeticao(lembrete);
      return true;
    }

    if (lembrete.tipoEspecial === "fechar_grupo") {
      await sock.groupSettingUpdate(lembrete.grupo, "announcement");
      await sock.sendMessage(lembrete.grupo, {
        text: "🔒 Grupo fechado automaticamente!"
      });
      console.log(`✔ Grupo ${lembrete.grupo} fechado via agendamento`);
      atualizarRepeticao(lembrete);
      return true;
    }

    // ---------------------------------------------------------
    // LEMBRETE NORMAL — envia texto com menções
    // ---------------------------------------------------------
    const meta = await sock.groupMetadata(lembrete.grupo);
    const ids = meta.participants.map(p => p.id);

    await sock.sendMessage(lembrete.grupo, {
      text: `🔔 *LEMBRETE!*\n${lembrete.texto}`,
      mentions: ids
    });

    console.log(`✔ Lembrete enviado para o grupo ${lembrete.grupo}`);

    atualizarRepeticao(lembrete);
    return true;

  } catch (e) {
    console.log("❌ Erro ao enviar lembrete:", e);
    return false;
  }
}

// ---------------------------------------------------------
// Atualiza o lembrete caso repeat = daily/weekly/monthly
// ---------------------------------------------------------
function atualizarRepeticao(lembrete) {
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));

  const entry = db.lembretes.find(l => l.id === lembrete.id);
  if (!entry) return;

  const agora = new Date(entry.quando);

  if (entry.repeat === "daily") {
    agora.setDate(agora.getDate() + 1);
  } else if (entry.repeat === "weekly") {
    agora.setDate(agora.getDate() + 7);
  } else if (entry.repeat === "monthly") {
    agora.setMonth(agora.getMonth() + 1);
  } else {
    // Se não repete, remove
    db.lembretes = db.lembretes.filter(l => l.id !== entry.id);
    fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
    return;
  }

  entry.quando = agora.toISOString();
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
}
