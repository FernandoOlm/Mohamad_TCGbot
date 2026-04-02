import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Garante que a pasta data existe na raiz do projeto
const dataDir = path.resolve("src/data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "database.sqlite");
const db = new sqlite3.Database(dbPath);

// Inicialização das tabelas (Assíncrona com sqlite3)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS boas_vindas (
      grupo_id TEXT PRIMARY KEY,
      mensagem TEXT,
      ativo INTEGER DEFAULT 1,
      atualizado TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alvo TEXT,
      admin TEXT,
      grupo_origem TEXT,
      motivo TEXT,
      data INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS autorizados (
      grupo_id TEXT,
      usuario_id TEXT,
      PRIMARY KEY (grupo_id, usuario_id)
    )
  `);
});

// Funções Auxiliares (Promisified para compatibilidade com o código atual)
export const dbQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error("Erro na query SQLite:", err.message);
        resolve([]);
      } else {
        resolve(rows);
      }
    });
  });
};

export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        console.error("Erro no run SQLite:", err.message);
        resolve({ id: 0, changes: 0 });
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error("Erro no get SQLite:", err.message);
        resolve(null);
      } else {
        resolve(row || null);
      }
    });
  });
};

export default db;
