const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
const fs = require('fs');
const path = require('path');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const logger = require('pino')({ level: 'silent' }); // Reduced logging

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Session management
let activeSocket = null;
let pairingCode = null;
let sessionData = null;
let retryCount = 0;
const MAX_RETRIES = 3;

// Enhanced connection handler
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("pairing_session");
    
    try {
        const socket = makeWASocket({
            auth: state,
            logger,
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "22.04.4"],
            connectTimeoutMs: 30000,
            keepAliveIntervalMs: 15000,
            markOnlineOnConnect: false, // Reduce connection load
        });

        socket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                if (reason === DisconnectReason.connectionLost && retryCount < MAX_RETRIES) {
                    retryCount++;
                    console.log(`Reconnecting... Attempt ${retryCount}/${MAX_RETRIES}`);
                    setTimeout(connectToWhatsApp, 2000);
                } else {
                    console.log('Connection terminated:', DisconnectReason[reason] || reason);
                    activeSocket = null;
                }
            } else if (connection === 'open') {
                console.log('Successfully connected to WhatsApp');
                retryCount = 0; // Reset on successful connection
            }
        });

        socket.ev.on('creds.update', saveCreds);
        return socket;
    } catch (error) {
        console.error('Connection error:', error);
        return null;
    }
}

// Routes
app.post('/start-pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!/^\d+$/.test(phoneNumber)) {
        return res.status(400).json({ error: 'Invalid phone number format' });
    }

    try {
        if (!activeSocket) {
            activeSocket = await connectToWhatsApp();
            if (!activeSocket) {
                throw new Error('Failed to establish WhatsApp connection');
            }
        }

        pairingCode = await activeSocket.requestPairingCode(phoneNumber);
        
        // Watch for session file changes
        const sessionPath = path.join(__dirname, 'pairing_session', 'creds.json');
        const watcher = fs.watch(sessionPath, (eventType) => {
            if (eventType === 'change') {
                sessionData = fs.readFileSync(sessionPath, 'utf-8');
                watcher.close(); // Stop watching after getting the session
            }
        });

        res.json({ 
            success: true, 
            pairingCode: pairingCode.match(/.{1,4}/g)?.join("-") || pairingCode 
        });
    } catch (error) {
        console.error('Pairing error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to generate pairing code' 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: activeSocket ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString() 
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Pairing site running on http://localhost:${PORT}`);
    // Initialize connection on startup
    connectToWhatsApp().then(sock => activeSocket = sock);
});

// Cleanup on exit
process.on('SIGINT', () => {
    if (activeSocket) {
        activeSocket.end();
    }
    process.exit();
});
