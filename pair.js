
import express from 'express';
import archiver from 'archiver';
import fs from 'fs';
import pino from 'pino';

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

import pn from 'awesome-phonenumber';

const router = express.Router();

const logger = pino({ level: 'fatal' });

// Remove session directory
function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;

        fs.rmSync(filePath, {
            recursive: true,
            force: true
        });

        return true;
    } catch (error) {
        console.error('Error removing session:', error);
        return false;
    }
}

// Create complete session ZIP
function createSessionZip(sessionDir) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        const chunks = [];

        archive.on('data', chunk => {
            chunks.push(chunk);
        });

        archive.on('error', reject);
        archive.on('warning', reject);

        archive.on('end', () => {
            resolve(Buffer.concat(chunks));
        });

        archive.directory(sessionDir, false);

        archive.finalize().catch(reject);
    });
}

router.get('/', async (req, res) => {

    // Get and validate phone number
    let num = req.query.number;

    if (typeof num !== 'string' || !num.trim()) {
        return res.status(400).send({
            error: 'Phone number is required'
        });
    }

    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).send({
            error: 'Invalid phone number. Please enter your full international number.'
        });
    }

    // Normalize phone number
    num = phone.getNumber('e164').replace('+', '');

    // Create a unique session directory
    const dirs = './' + num + '-' + Date.now();

    const userJid = jidNormalizedUser(
        num + '@s.whatsapp.net'
    );

    // Prevent duplicate delivery and reconnect attempts
    let deliveryStarted = false;
    let reconnecting = false;

    async function initiateSession() {

        const { state, saveCreds } =
            await useMultiFileAuthState(dirs);

        try {

            const { version } =
                await fetchLatestBaileysVersion();

            const KnightBot = makeWASocket({

                version,

                auth: {
                    creds: state.creds,

                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        logger
                    )
                },

                printQRInTerminal: false,

                logger,

                browser: Browsers.windows('Chrome'),

                markOnlineOnConnect: false,

                generateHighQualityLinkPreview: false,

                defaultQueryTimeoutMs: 60000,

                connectTimeoutMs: 60000,

                keepAliveIntervalMs: 30000,

                retryRequestDelayMs: 250,

                maxRetries: 5
            });

            // Save credentials immediately
            KnightBot.ev.on('creds.update', saveCreds);

            // Connection updates
            KnightBot.ev.on(
                'connection.update',
                async (update) => {

                    const {
                        connection,
                        lastDisconnect,
                        isNewLogin,
                        isOnline
                    } = update;

                    // Successfully connected
                    if (connection === 'open') {

                        console.log('✅ Connected successfully!');

                        // Prevent duplicate ZIP delivery
                        if (deliveryStarted) return;

                        deliveryStarted = true;

                        try {

                            console.log('💾 Saving session credentials...');

                            // Allow session files to finish updating
                            await delay(1500);

                            await saveCreds();

                            console.log('📦 Creating complete session ZIP...');

                            // Include credentials and Signal keys
                            const sessionZip =
                                await createSessionZip(dirs);

                            if (!sessionZip || sessionZip.length === 0) {
                                throw new Error('Session ZIP is empty');
                            }

                            console.log('📱 Sending session ZIP...');

                            // Send complete session to the user's WhatsApp
                            await KnightBot.sendMessage(userJid, {

                                document: sessionZip,

                                mimetype: 'application/zip',

                                fileName: 'madara-session.zip'

                            });

                            console.log('✅ Complete session ZIP sent successfully!');

                            // Send setup guide
                            await KnightBot.sendMessage(userJid, {

                                image: {
                                    url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg'
                                },

                                caption:
                                    `🎬 *KnightBot MD V2.0 Full Setup Guide!*\n\n` +
                                    `🚀 Bug Fixes + New Commands + Fast AI Chat\n` +
                                    `📺 Watch Now: https://youtu.be/NjOipI2AoMk`

                            });

                            console.log('🎬 Video guide sent successfully');

                            // Send warning
                            await KnightBot.sendMessage(userJid, {

                                text:
                                    `⚠️ Do not share this file with anybody ⚠️\n\n` +
                                    `┌┤✑  Thanks for using Knight Bot\n` +
                                    `│└────────────┈ ⳹\n` +
                                    `│©2025 Mr Unique Hacker\n` +
                                    `└─────────────────┈ ⳹\n\n`

                            });

                            console.log('⚠️ Warning message sent successfully');

                            // Delete files only after successful delivery
                            console.log('🧹 Cleaning up session...');

                            await delay(1000);

                            if (removeFile(dirs)) {
                                console.log('✅ Session cleaned up successfully');
                            }

                            console.log('🎉 Process completed successfully!');

                        } catch (error) {

                            console.error(
                                '❌ Error sending session:',
                                error
                            );

                            // Keep session files if delivery fails
                            deliveryStarted = false;

                            console.log(
                                '⚠️ Session files have been preserved.'
                            );
                        }
                    }

                    if (isNewLogin) {
                        console.log('🔐 New login via pair code');
                    }

                    if (isOnline) {
                        console.log('📶 Client is online');
                    }

                    // Connection closed
                    if (connection === 'close') {

                        const statusCode =
                            lastDisconnect?.error?.output?.statusCode;

                        if (statusCode === 401) {

                            console.log(
                                '❌ Logged out from WhatsApp.'
                            );

                            return;
                        }

                        if (deliveryStarted) return;

                        if (!reconnecting) {

                            reconnecting = true;

                            console.log(
                                '🔁 Connection closed — restarting...'
                            );

                            await delay(2000);

                            reconnecting = false;

                            initiateSession().catch(error => {
                                console.error(
                                    'Reconnect error:',
                                    error
                                );
                            });
                        }
                    }
                }
            );

            // Request pairing code
            if (!KnightBot.authState.creds.registered) {

                await delay(3000);

                try {

                    let code =
                        await KnightBot.requestPairingCode(num);

                    code =
                        code?.match(/.{1,4}/g)?.join('-') || code;

                    if (!res.headersSent && !res.writableEnded) {

                        console.log({
                            number: num,
                            code
                        });

                        res.send({ code });
                    }

                } catch (error) {

                    console.error(
                        'Error requesting pairing code:',
                        error
                    );

                    if (!res.headersSent && !res.writableEnded) {

                        res.status(503).send({
                            code: 'Failed to get pairing code. Please check your phone number and try again.'
                        });
                    }
                }
            }

        } catch (error) {

            console.error(
                'Error initializing session:',
                error
            );

            if (!res.headersSent && !res.writableEnded) {

                res.status(503).send({
                    code: 'Service Unavailable'
                });
            }
        }
    }

    await initiateSession();

});

// Global uncaught exception handler
process.on('uncaughtException', (err) => {

    const error = String(err);

    if (error.includes('conflict')) return;
    if (error.includes('not-authorized')) return;
    if (error.includes('Socket connection timeout')) return;
    if (error.includes('rate-overlimit')) return;
    if (error.includes('Connection Closed')) return;
    if (error.includes('Timed Out')) return;
    if (error.includes('Value not found')) return;
    if (error.includes('Stream Errored')) return;
    if (error.includes('Stream Errored (restart required)')) return;
    if (error.includes('statusCode: 515')) return;
    if (error.includes('statusCode: 503')) return;

    console.log('Caught exception:', err);
});

export default router;

