const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Global variables to store session data
let pairingSocket = null;
let pairingCode = null;
let sessionData = null;

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/start-pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    
    try {
        // Initialize WhatsApp socket
        const { state, saveCreds } = await useMultiFileAuthState("pairing_session");
        pairingSocket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
        });

        // Request pairing code
        pairingCode = await pairingSocket.requestPairingCode(phoneNumber);
        
        // Listen for credentials update
        pairingSocket.ev.on('creds.update', async () => {
            // Read the session file
            const sessionPath = path.join(__dirname, 'pairing_session', 'creds.json');
            if (fs.existsSync(sessionPath)) {
                sessionData = fs.readFileSync(sessionPath, 'utf-8');
                console.log('Session data captured:', sessionData);
                
                // Clean up
                await pairingSocket.end();
                pairingSocket = null;
            }
        });

        res.json({ 
            success: true, 
            pairingCode: pairingCode.match(/.{1,4}/g)?.join("-") || pairingCode 
        });
    } catch (error) {
        console.error('Pairing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/check-session', (req, res) => {
    res.json({ 
        hasSession: !!sessionData,
        sessionData: sessionData 
    });
});

app.get('/download-session', (req, res) => {
    if (!sessionData) {
        return res.status(404).send('Session not available yet');
    }
    
    res.setHeader('Content-disposition', 'attachment; filename=creds.json');
    res.setHeader('Content-type', 'application/json');
    res.send(sessionData);
});

// Start server
app.listen(PORT, () => {
    console.log(`Pairing site running on http://localhost:${PORT}`);
});
