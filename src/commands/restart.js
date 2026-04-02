// ============================================================
// restart.js — Comando !restart
// Dispara o update.sh em background (git pull + pm2 restart)
// Silencioso: não responde nada no grupo
// ============================================================
import { spawn } from "child_process";
import path from "path";

export async function restart(msg, sock, fromClean) {
  const scriptPath = path.resolve("update.sh");

  // Dispara o script em background, completamente desacoplado do processo atual
  const child = spawn("bash", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });

  child.unref(); // desacopla do processo pai — o bot pode morrer sem afetar o script

  // Retorna null para que o clawBrain não envie nenhuma resposta
  return null;
}
