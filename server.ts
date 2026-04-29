import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Lazy Firebase Admin Initialization
  let messaging: admin.messaging.Messaging | null = null;

  function getMessaging() {
    if (!messaging) {
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!serviceAccount) {
        console.warn("FIREBASE_SERVICE_ACCOUNT environment variable is missing. Push notifications will not be sent.");
        return null;
      }
      try {
        const cert = JSON.parse(serviceAccount);
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(cert),
          });
        }
        messaging = admin.messaging();
      } catch (error) {
        console.error("Error initializing Firebase Admin:", error);
        return null;
      }
    }
    return messaging;
  }

  // API Route to send push notifications
  app.post("/api/send-push", async (req, res) => {
    const { tokens, title, body, data } = req.body;

    if (!tokens || !tokens.length) {
      return res.status(400).json({ error: "No tokens provided" });
    }

    const fcm = getMessaging();
    if (!fcm) {
      return res.status(503).json({ error: "Push notification service not configured" });
    }

    try {
      const response = await fcm.sendEachForMulticast({
        tokens,
        notification: {
          title,
          body,
        },
        data: data || {},
      });

      res.json({
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });
    } catch (error) {
      console.error("Error sending push notifications:", error);
      res.status(500).json({ error: "Failed to send notifications" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
