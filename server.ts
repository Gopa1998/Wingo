import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Game State Simulation
  let history: any[] = [];
  let currentWinningNumber: number | null = null;
  let currentPeriodId: string | null = null;

  const getGameState = () => {
    const now = new Date();
    const totalSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const timeLeft = 30 - (totalSeconds % 30);
    
    const dateStr = now.getFullYear().toString() + 
                    (now.getMonth() + 1).toString().padStart(2, '0') + 
                    now.getDate().toString().padStart(2, '0');
    // Format: YYYYMMDD + 1000 + 5-digit sequence
    const sequenceNum = Math.floor(totalSeconds / 30);
    const sequence = (50000 + sequenceNum).toString().padStart(5, '0');
    const currentPeriod = `${dateStr}1000${sequence}`;

    // If period changed, generate a new winning number
    if (currentPeriod !== currentPeriodId) {
      // Add previous result to history if it exists
      if (currentPeriodId && currentWinningNumber !== null) {
        history.unshift({
          period: currentPeriodId,
          number: currentWinningNumber,
          size: currentWinningNumber >= 5 ? "BIG" : "SMALL"
        });
        if (history.length > 50) history.pop();
        
        // Broadcast history update
        broadcast({ type: 'HISTORY', data: history.slice(0, 10) });
      }
      
      currentPeriodId = currentPeriod;
      // Generate a deterministic-looking but random winning number for the new period
      currentWinningNumber = Math.floor(Math.random() * 10);
    }

    return {
      currentPeriod,
      timeLeft,
      serverTime: now.getTime()
    };
  };

  // Initialize history with some data
  const initHistory = () => {
    const now = new Date();
    const totalSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const currentSequenceNum = Math.floor(totalSeconds / 30);
    const dateStr = now.getFullYear().toString() + 
                    (now.getMonth() + 1).toString().padStart(2, '0') + 
                    now.getDate().toString().padStart(2, '0');

    for (let i = 1; i <= 10; i++) {
      const seq = (50000 + currentSequenceNum - i).toString().padStart(5, '0');
      const num = Math.floor(Math.random() * 10);
      history.push({
        period: `${dateStr}1000${seq}`,
        number: num,
        size: num >= 5 ? "BIG" : "SMALL"
      });
    }
  };
  initHistory();

  // WebSocket Server
  const wss = new WebSocketServer({ server });

  const broadcast = (data: any) => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // Broadcast game state every second
  setInterval(() => {
    const state = getGameState();
    broadcast({ type: 'GAME_STATE', ...state });
  }, 1000);

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    // Send initial state and history
    ws.send(JSON.stringify({ type: 'HISTORY', data: history.slice(0, 10) }));
    ws.send(JSON.stringify({ type: 'GAME_STATE', ...getGameState() }));

    ws.on('close', () => console.log('[WS] Client disconnected'));
  });

  // Request Logging Middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[API] ${req.method} ${req.path}`);
    }
    next();
  });

  // API Routes
  app.get("/api/game-state", (req, res) => {
    res.json(getGameState());
  });

  app.get("/api/predict", (req, res) => {
    // Return the "accurate" prediction for the current period
    const isBig = currentWinningNumber! >= 5;
    const possibleNumbers = isBig ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
    // Ensure the actual winning number is one of the suggested numbers for "accuracy"
    const suggested = [currentWinningNumber!, ...possibleNumbers.filter(n => n !== currentWinningNumber)]
      .sort(() => 0.5 - Math.random())
      .slice(0, 3);
    
    res.json({
      size: isBig ? 'BIG' : 'SMALL',
      numbers: suggested
    });
  });

  app.get("/api/predict-manual", (req, res) => {
    const { periodId } = req.query;
    
    // If it's the current period, return the accurate prediction
    if (periodId === currentPeriodId) {
      const isBig = currentWinningNumber! >= 5;
      const possibleNumbers = isBig ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
      const suggested = [currentWinningNumber!, ...possibleNumbers.filter(n => n !== currentWinningNumber)]
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);
      
      return res.json({
        size: isBig ? 'BIG' : 'SMALL',
        numbers: suggested
      });
    }

    // Otherwise, generate a deterministic-looking prediction
    const seed = periodId ? String(periodId).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : Math.random();
    const pseudoRandom = (seed % 100) / 100;
    
    const isBig = pseudoRandom > 0.5;
    const possibleNumbers = isBig ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
    const suggested = [...possibleNumbers].sort(() => 0.5 - Math.random()).slice(0, 3);
    
    res.json({
      size: isBig ? 'BIG' : 'SMALL',
      numbers: suggested
    });
  });

  app.get("/api/predict-stream", (req, res) => {
    const { periodId } = req.query;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendLog = (message: string) => {
      res.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
    };

    const logs = [
      "Initializing AI Core...",
      "Establishing secure connection to game server...",
      "Fetching historical data for period " + periodId,
      "Analyzing sequence patterns (last 500 rounds)...",
      "Calculating volatility index...",
      "Evaluating trend momentum...",
      "Running Monte Carlo simulations...",
      "Pattern match found in cluster " + (Math.floor(Math.random() * 1000) % 10),
      "Cross-referencing with live player trends...",
      "Synchronizing with global trend data...",
      "Applying neural network weights...",
      "Finalizing prediction..."
    ];

    let currentLog = 0;
    const interval = setInterval(() => {
      if (currentLog < logs.length) {
        sendLog(logs[currentLog]);
        currentLog++;
      } else {
        let isBig, suggested, confidence;

        if (periodId === currentPeriodId) {
          isBig = currentWinningNumber! >= 5;
          const possibleNumbers = isBig ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
          suggested = [currentWinningNumber!, ...possibleNumbers.filter(n => n !== currentWinningNumber)]
            .sort(() => 0.5 - Math.random())
            .slice(0, 3);
          confidence = Math.floor(85 + Math.random() * 10);
        } else {
          const seed = periodId ? String(periodId).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : Math.random();
          const pseudoRandom = (seed % 100) / 100;
          isBig = pseudoRandom > 0.5;
          const possibleNumbers = isBig ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
          suggested = [...possibleNumbers].sort(() => 0.5 - Math.random()).slice(0, 3);
          confidence = Math.floor(75 + pseudoRandom * 20);
        }

        res.write(`data: ${JSON.stringify({ 
          type: 'result', 
          data: {
            size: isBig ? 'BIG' : 'SMALL',
            numbers: suggested,
            confidence: confidence
          } 
        })}\n\n`);
        
        clearInterval(interval);
        res.end();
      }
    }, 400);

    req.on('close', () => {
      clearInterval(interval);
    });
  });

  app.get("/api/history", (req, res) => {
    res.json(history.slice(0, 10));
  });

  // API 404 Handler - Prevent SPA fallback for missing API routes
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
