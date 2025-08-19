import cron from "node-cron";
import path from "path";
import express from "express";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";

const app = express();
const port = 8080;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = path.join(__dirname, "db", "data.db");

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.log("Error connecting to the database", err.message);
        return;
    }

    console.log("Connected to the SQLite database");

    db.run(
        `CREATE TABLE IF NOT EXISTS dollar_bcv (id INTEGER PRIMARY KEY AUTOINCREMENT, 
        average FLOAT NOT NULL,
        date STRING NOT NULL)`,
        (err) => {
            if (err) {
                console.log("Error creating table:", err.message);
                return;
            }

            console.log("Table created or already exists");
        },
    );
});

async function checkDollarRate() {
    const url = "https://ve.dolarapi.com/v1/dolares/oficial";

    try {
        const response = await fetch(url);

        if (response.status !== 200) {
            throw new Error("API Responded with status:", response.status);
        }

        const data = await response.json();

        db.run(`INSERT INTO dollar_bcv (average, date) VALUES (?, ?)`, [
            parseFloat(data.promedio),
            new Date().toISOString(),
        ]);

        return { status: "success" };
    } catch (error) {
        console.error("[DolarAPI Error]", error);
        throw error;
    }
}

async function healthCheck() {
    try {
        const baseUrl = process.env.RENDER_EXTERNAL_URL || "http://localhost:8080";
        // const response = await axios.get(`${baseUrl}/health`);
        const response = await fetch(`${baseUrl}/health`);
        console.log("Health check success");
        return true;
    } catch (error) {
        console.error("Health check fail:", error.message);
        return false;
    }
}

function setupCronJob() {
    const job = cron.schedule(
        "15 9 * * *",
        async () => {
            try {
                await checkDollarRate();
                console.log("Cron running");
            } catch (error) {
                console.error("Error en la ejecución programada:", error);
            }
        },
        {
            timezone: "America/Caracas",
        },
    );

    console.log("Cron job settled to executed daily at 9:15 AM");
    return job;
}

const cronJob = setupCronJob();
cronJob.getNextRun();

app.get("/cron-status", (req, res) => {
    res.json({
        nextExecution: cronJob.getNextRun().toISOString(),
        cronExpression: "15 9 * * *",
        timezone: "America/Caracas",
        description: "Ejecuta diariamente a las 9:15 AM",
    });
});

// Configurar cron job para health check cada 5 minutos
cron.schedule(
    "* * * * *",
    async () => {
        console.log("Ejecutando health check...");
        await healthCheck();
    },
    {
        scheduled: true,
        timezone: "America/Caracas",
    },
);

app.get("/dollar", (req, res) => {
    db.get("SELECT * FROM dollar_bcv ORDER BY id DESC LIMIT 1", (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error" });
        }
        res.status(200).json(row || { message: "No hay registros" });
    });
});

app.get("/history", (req, res) => {
    const sql = "SELECT * FROM dollar_bcv";

    db.all(sql, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        res.json(rows);
    });
});

// Health check endpoint (necesario)
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "dolar-api-cron",
    });
});

app.get("/check", async (req, res) => {
    try {
        const result = await checkDollarRate();

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log("Server running in port:", port);
});

process.on("SIGINT", () => {
    db.close((err) => {
        if (err) {
            console.log("Error closing Database", err.message);
            return;
        }

        console.log("Database connection closed");
        process.exit(0);
    });
});
