// =====================================================
// TESTES — Sistema de Lembretes do Ferdinando
// Executa: node tests/test_lembretes.js
// =====================================================

import fs from "fs";
import path from "path";

const REMINDERS_PATH = path.resolve("src/data/reminders.json");

// =====================================================
// HELPERS
// =====================================================
let totalTests = 0;
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    failures.push(testName);
    console.log(`  ❌ ${testName}`);
  }
}

function resetReminders() {
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify({ lembretes: [] }, null, 2));
}

function makeMsgGroup(texto, jid = "123456@g.us") {
  return {
    key: { remoteJid: jid, participant: "5511999999999@s.whatsapp.net" },
    message: { conversation: texto }
  };
}

function makeMsgPV(texto) {
  return {
    key: { remoteJid: "5511999999999@s.whatsapp.net" },
    message: { conversation: texto }
  };
}

// Mock sock
const sentMessages = [];
let settingUpdates = [];
const mockSock = {
  sendMessage: async (jid, content) => {
    sentMessages.push({ jid, ...content });
  },
  groupMetadata: async (jid) => ({
    participants: [
      { id: "5511999999999@s.whatsapp.net" },
      { id: "5511888888888@s.whatsapp.net" }
    ]
  }),
  groupSettingUpdate: async (jid, setting) => {
    settingUpdates.push({ jid, setting });
  }
};

function clearSent() {
  sentMessages.length = 0;
  settingUpdates.length = 0;
}

// =====================================================
// IMPORTAÇÕES
// =====================================================
const { comandoLembrete, cmdLembrete, cmdLembreteDiario, cmdLembreteSemanal, cmdLembreteMensal, cmdDesativarLembrete } = await import("../src/commands/lembretes.js");
const { cmdListarLembretes } = await import("../src/commands/listar-lembretes.js");
const { cmdApagarLembrete } = await import("../src/commands/apagar-lembrete.js");
const { enviar_lembrete } = await import("../src/commands/enviar-lembrete.js");

// =====================================================
// TESTE 1: !lembrete — Criação básica com data/hora/mensagem
// =====================================================
console.log("\n📋 TESTE 1: !lembrete — Criação básica");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete 15/06/2026 14:30 Reunião importante");
  const result = await cmdLembrete(msg, mockSock, "5511999999999", ["15/06/2026", "14:30", "Reunião", "importante"]);
  
  assert(result !== undefined && result !== null, "Retorna resultado (não undefined)");
  assert(result?.resposta !== undefined || result?.mensagem !== undefined || result?.texto !== undefined, 
    "Retorna campo reconhecido pelo clawBrain");
  
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(db.lembretes.length === 1, "Lembrete salvo no JSON");
  assert(db.lembretes[0].texto === "Reunião importante", "Texto do lembrete correto");
  assert(db.lembretes[0].repeat === null, "Sem repetição (único)");
  
  const respTxt = result?.resposta || result?.mensagem || result?.texto || "";
  assert(respTxt.includes("Reunião importante") || respTxt.includes("criado"), "Resposta é contextualizada");
}

// =====================================================
// TESTE 2: !lembrete — Com repetição diária
// =====================================================
console.log("\n📋 TESTE 2: !lembrete — Com repetição diária (D)");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete 15/06/2026 08:00 D Bom dia galera");
  const result = await cmdLembrete(msg, mockSock, "5511999999999", ["15/06/2026", "08:00", "D", "Bom", "dia", "galera"]);
  
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(db.lembretes.length === 1, "Lembrete salvo");
  assert(db.lembretes[0].repeat === "daily", "Repetição diária detectada");
  assert(db.lembretes[0].texto === "Bom dia galera", "Texto correto (sem o D)");
}

// =====================================================
// TESTE 3: !lembrete — Com repetição semanal
// =====================================================
console.log("\n📋 TESTE 3: !lembrete — Com repetição semanal (S)");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete 15/06/2026 10:00 S Reunião semanal");
  const result = await cmdLembrete(msg, mockSock, "5511999999999", ["15/06/2026", "10:00", "S", "Reunião", "semanal"]);
  
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(db.lembretes[0].repeat === "weekly", "Repetição semanal detectada");
}

// =====================================================
// TESTE 4: !lembrete — Com repetição mensal
// =====================================================
console.log("\n📋 TESTE 4: !lembrete — Com repetição mensal (M)");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete 15/06/2026 10:00 M Pagamento");
  const result = await cmdLembrete(msg, mockSock, "5511999999999", ["15/06/2026", "10:00", "M", "Pagamento"]);
  
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(db.lembretes[0].repeat === "monthly", "Repetição mensal detectada");
}

// =====================================================
// TESTE 5: !lembrete — Em PV (deve rejeitar)
// =====================================================
console.log("\n📋 TESTE 5: !lembrete — Em PV (deve rejeitar)");
resetReminders();
{
  const msg = makeMsgPV("!lembrete 15/06/2026 08:00 Teste");
  const result = await cmdLembrete(msg, mockSock, "5511999999999", []);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("grupo"), "Rejeita uso em PV com mensagem sobre grupos");
}

// =====================================================
// TESTE 6: !lembrete — Sem argumentos suficientes
// =====================================================
console.log("\n📋 TESTE 6: !lembrete — Sem argumentos suficientes");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete 15/06/2026");
  const result = await cmdLembrete(msg, mockSock, "5511999999999", ["15/06/2026"]);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("Formato") || respTxt.includes("inválido") || respTxt.includes("Use"), "Retorna erro de formato");
}

// =====================================================
// TESTE 7: !lembrete — Data inválida
// =====================================================
console.log("\n📋 TESTE 7: !lembrete — Data inválida");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete abc 08:00 Teste");
  const result = await cmdLembrete(msg, mockSock, "5511999999999", ["abc", "08:00", "Teste"]);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("inválida") || respTxt.includes("Data"), "Retorna erro de data inválida");
}

// =====================================================
// TESTE 8: !lembrete-diario — Atalho (CORRIGIDO)
// =====================================================
console.log("\n📋 TESTE 8: !lembrete-diario — Atalho");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete-diario 08:00 Bom dia");
  const result = await cmdLembreteDiario(msg, mockSock, "5511999999999", ["08:00", "Bom", "dia"]);
  
  assert(result !== undefined, "Retorna resultado");
  
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(db.lembretes.length === 1, "Lembrete diário criado pelo atalho");
  if (db.lembretes.length === 1) {
    assert(db.lembretes[0].repeat === "daily", "Repetição é daily");
    assert(db.lembretes[0].texto === "Bom dia", "Texto correto");
  }
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("Diário") || respTxt.includes("diário") || respTxt.includes("criado"), "Resposta confirma criação diária");
}

// =====================================================
// TESTE 9: !lembrete-semanal — Atalho (CORRIGIDO)
// =====================================================
console.log("\n📋 TESTE 9: !lembrete-semanal — Atalho");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete-semanal 10:00 Reunião");
  const result = await cmdLembreteSemanal(msg, mockSock, "5511999999999", ["10:00", "Reunião"]);
  
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(db.lembretes.length === 1, "Lembrete semanal criado pelo atalho");
  if (db.lembretes.length === 1) {
    assert(db.lembretes[0].repeat === "weekly", "Repetição é weekly");
  }
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("Semanal") || respTxt.includes("semanal"), "Resposta confirma criação semanal");
}

// =====================================================
// TESTE 10: !lembrete-mensal — Atalho (CORRIGIDO)
// =====================================================
console.log("\n📋 TESTE 10: !lembrete-mensal — Atalho");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete-mensal 10:00 Pagamento");
  const result = await cmdLembreteMensal(msg, mockSock, "5511999999999", ["10:00", "Pagamento"]);
  
  const db = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(db.lembretes.length === 1, "Lembrete mensal criado pelo atalho");
  if (db.lembretes.length === 1) {
    assert(db.lembretes[0].repeat === "monthly", "Repetição é monthly");
  }
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("Mensal") || respTxt.includes("mensal"), "Resposta confirma criação mensal");
}

// =====================================================
// TESTE 11: !listar-lembretes — Com lembretes (CORRIGIDO)
// =====================================================
console.log("\n📋 TESTE 11: !listar-lembretes — Com lembretes");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando: "2026-06-15T14:30:00.000Z", texto: "Teste listar", repeat: "daily" }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  clearSent();
  const msg = makeMsgGroup("!listar-lembretes");
  const result = await cmdListarLembretes(msg, mockSock, "5511999999999", []);
  
  assert(result !== undefined && result !== null, "Retorna dados (não undefined)");
  
  const respTxt = result?.resposta || result?.mensagem || result?.texto || "";
  assert(respTxt.includes("Teste listar"), "Resposta contém texto do lembrete");
  assert(respTxt.includes("ID"), "Resposta contém ID");
  assert(sentMessages.length === 0, "NÃO envia direto pelo sock (evita Feito. duplicado)");
}

// =====================================================
// TESTE 12: !listar-lembretes — Sem lembretes
// =====================================================
console.log("\n📋 TESTE 12: !listar-lembretes — Sem lembretes");
resetReminders();
{
  clearSent();
  const msg = makeMsgGroup("!listar-lembretes");
  const result = await cmdListarLembretes(msg, mockSock, "5511999999999", []);
  
  assert(result !== undefined && result !== null, "Retorna dados (não undefined)");
  const respTxt = result?.resposta || result?.mensagem || result?.texto || "";
  assert(respTxt.includes("Nenhum") || respTxt.includes("nenhum"), "Indica que não há lembretes");
}

// =====================================================
// TESTE 13: !apagar-lembrete — Assinatura corrigida
// =====================================================
console.log("\n📋 TESTE 13: !apagar-lembrete — Assinatura corrigida");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando: "2026-06-15T14:30:00.000Z", texto: "Para apagar", repeat: null }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  clearSent();
  const msg = makeMsgGroup("!apagar-lembrete 1");
  
  // Simula como o DISPATCHER chama: fn(msg, sock, fromClean, args)
  const result = await cmdApagarLembrete(msg, mockSock, "5511999999999", ["1"]);
  
  assert(result !== undefined && result !== null, "Retorna dados (não undefined)");
  
  const dbAfter = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(dbAfter.lembretes.length === 0, "Lembrete foi apagado corretamente");
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("apagado") || respTxt.includes("removido"), "Resposta confirma remoção");
  assert(respTxt.includes("Para apagar"), "Resposta inclui texto do lembrete removido");
  assert(sentMessages.length === 0, "NÃO envia direto pelo sock");
}

// =====================================================
// TESTE 14: !apagar-lembrete — Sem ID
// =====================================================
console.log("\n📋 TESTE 14: !apagar-lembrete — Sem ID");
resetReminders();
{
  const msg = makeMsgGroup("!apagar-lembrete");
  const result = await cmdApagarLembrete(msg, mockSock, "5511999999999", []);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("Use") || respTxt.includes("ID"), "Retorna instrução de uso");
}

// =====================================================
// TESTE 15: !apagar-lembrete — ID de outro grupo
// =====================================================
console.log("\n📋 TESTE 15: !apagar-lembrete — ID de outro grupo (segurança)");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "OUTRO_GRUPO@g.us", autor: "5511999999999", quando: "2026-06-15T14:30:00.000Z", texto: "Lembrete de outro grupo", repeat: null }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  const msg = makeMsgGroup("!apagar-lembrete 1");
  const result = await cmdApagarLembrete(msg, mockSock, "5511999999999", ["1"]);
  
  const dbAfter = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(dbAfter.lembretes.length === 1, "NÃO apaga lembrete de outro grupo");
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("não encontrado"), "Retorna erro de não encontrado");
}

// =====================================================
// TESTE 16: !desativar-lembrete — DESATIVA (não remove)
// =====================================================
console.log("\n📋 TESTE 16: !desativar-lembrete — Desativa (não remove)");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando: "2026-06-15T14:30:00.000Z", texto: "Para desativar", repeat: "daily" }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  const msg = makeMsgGroup("!desativar-lembrete 1");
  const result = await cmdDesativarLembrete(msg, mockSock, "5511999999999", ["1"]);
  
  const dbAfter = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  const lembrete = dbAfter.lembretes.find(l => l.id === 1);
  
  assert(lembrete !== undefined, "Lembrete ainda existe no JSON (não foi removido)");
  assert(lembrete?.ativo === false, "Lembrete marcado como ativo=false");
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("desativado") || respTxt.includes("Desativado"), "Resposta confirma desativação");
  assert(respTxt.includes("Para desativar"), "Resposta inclui texto do lembrete");
}

// =====================================================
// TESTE 17: !desativar-lembrete — Sem ID (lista)
// =====================================================
console.log("\n📋 TESTE 17: !desativar-lembrete — Sem ID (lista)");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando: "2026-06-15T14:30:00.000Z", texto: "Lembrete 1", repeat: "daily" }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  const msg = makeMsgGroup("!desativar-lembrete");
  const result = await cmdDesativarLembrete(msg, mockSock, "5511999999999", []);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("Lembrete") || respTxt.includes("ID"), "Lista lembretes quando sem ID");
}

// =====================================================
// TESTE 18: !desativar-lembrete — Já desativado
// =====================================================
console.log("\n📋 TESTE 18: !desativar-lembrete — Já desativado");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando: "2026-06-15T14:30:00.000Z", texto: "Já desativado", repeat: "daily", ativo: false }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  const msg = makeMsgGroup("!desativar-lembrete 1");
  const result = await cmdDesativarLembrete(msg, mockSock, "5511999999999", ["1"]);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("já") || respTxt.includes("Já"), "Informa que já está desativado");
}

// =====================================================
// TESTE 19: enviar_lembrete — Disparo básico
// =====================================================
console.log("\n📋 TESTE 19: enviar_lembrete — Disparo básico");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando: new Date(Date.now() - 60000).toISOString(), texto: "Lembrete disparado", repeat: null }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  clearSent();
  const ok = await enviar_lembrete(db.lembretes[0], mockSock);
  
  assert(ok === true, "Retorna true ao enviar");
  assert(sentMessages.length > 0, "Enviou mensagem ao grupo");
  if (sentMessages.length > 0) {
    assert(sentMessages[0].text.includes("Lembrete disparado"), "Texto do lembrete na mensagem");
  }
  
  const dbAfter = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(dbAfter.lembretes.length === 0, "Lembrete único removido após disparo");
}

// =====================================================
// TESTE 20: enviar_lembrete — Repetição diária avança data
// =====================================================
console.log("\n📋 TESTE 20: enviar_lembrete — Repetição diária");
resetReminders();
{
  const quando = "2026-06-15T08:00:00.000Z";
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando, texto: "Bom dia", repeat: "daily" }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  clearSent();
  await enviar_lembrete(db.lembretes[0], mockSock);
  
  const dbAfter = JSON.parse(fs.readFileSync(REMINDERS_PATH, "utf8"));
  assert(dbAfter.lembretes.length === 1, "Lembrete diário mantido");
  
  const novaData = new Date(dbAfter.lembretes[0].quando);
  const dataOriginal = new Date(quando);
  const diffDias = (novaData - dataOriginal) / (1000 * 60 * 60 * 24);
  assert(diffDias === 1, `Data avançou 1 dia (diff: ${diffDias})`);
}

// =====================================================
// TESTE 21: enviar_lembrete — tipoEspecial abrir_grupo (CORRIGIDO)
// =====================================================
console.log("\n📋 TESTE 21: enviar_lembrete — tipoEspecial abrir_grupo");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", tipoEspecial: "abrir_grupo", quando: new Date(Date.now() - 60000).toISOString(), texto: "Abrir grupo às 08:00", repeat: "daily" }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  clearSent();
  await enviar_lembrete(db.lembretes[0], mockSock);
  
  assert(settingUpdates.length > 0, "Executou groupSettingUpdate");
  if (settingUpdates.length > 0) {
    assert(settingUpdates[0].setting === "not_announcement", "Setting correto (not_announcement = abrir)");
  }
}

// =====================================================
// TESTE 22: enviar_lembrete — tipoEspecial fechar_grupo
// =====================================================
console.log("\n📋 TESTE 22: enviar_lembrete — tipoEspecial fechar_grupo");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", tipoEspecial: "fechar_grupo", quando: new Date(Date.now() - 60000).toISOString(), texto: "Fechar grupo às 22:00", repeat: "daily" }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  clearSent();
  await enviar_lembrete(db.lembretes[0], mockSock);
  
  assert(settingUpdates.length > 0, "Executou groupSettingUpdate");
  if (settingUpdates.length > 0) {
    assert(settingUpdates[0].setting === "announcement", "Setting correto (announcement = fechar)");
  }
}

// =====================================================
// TESTE 23: enviar_lembrete — Lembrete desativado não dispara
// =====================================================
console.log("\n📋 TESTE 23: enviar_lembrete — Lembrete desativado");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "123456@g.us", autor: "5511999999999", quando: new Date(Date.now() - 60000).toISOString(), texto: "Desativado", repeat: "daily", ativo: false }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  clearSent();
  const ok = await enviar_lembrete(db.lembretes[0], mockSock);
  
  assert(ok === false, "Retorna false para lembrete desativado");
  assert(sentMessages.length === 0, "NÃO envia mensagem");
}

// =====================================================
// TESTE 24: !lembrete-diario — Sem argumentos
// =====================================================
console.log("\n📋 TESTE 24: !lembrete-diario — Sem argumentos");
resetReminders();
{
  const msg = makeMsgGroup("!lembrete-diario");
  const result = await cmdLembreteDiario(msg, mockSock, "5511999999999", []);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("Formato") || respTxt.includes("inválido") || respTxt.includes("Use"), "Retorna erro de formato");
}

// =====================================================
// TESTE 25: !desativar-lembrete — ID de outro grupo
// =====================================================
console.log("\n📋 TESTE 25: !desativar-lembrete — ID de outro grupo");
resetReminders();
{
  const db = { lembretes: [{ id: 1, grupo: "OUTRO@g.us", autor: "5511999999999", quando: "2026-06-15T14:30:00.000Z", texto: "Outro grupo", repeat: "daily" }] };
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(db, null, 2));
  
  const msg = makeMsgGroup("!desativar-lembrete 1");
  const result = await cmdDesativarLembrete(msg, mockSock, "5511999999999", ["1"]);
  
  const respTxt = result?.resposta || result?.mensagem || "";
  assert(respTxt.includes("não encontrado"), "NÃO desativa lembrete de outro grupo");
}

// =====================================================
// RESULTADO FINAL
// =====================================================
console.log("\n" + "=".repeat(50));
console.log(`📊 RESULTADO: ${passed}/${totalTests} passaram, ${failed} falharam`);
if (failures.length > 0) {
  console.log("\n❌ Falhas:");
  failures.forEach(f => console.log(`   • ${f}`));
}
console.log("=".repeat(50));

// Limpa
resetReminders();
