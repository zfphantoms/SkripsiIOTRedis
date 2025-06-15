// routes/authRoutes.js
const express = require('express');
const router = express.Router(); // Menggunakan Express Router
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

let mysqlPool;
let redisClient;
let useRedisSession = false; // BARU: Default ke false, akan diisi dari app.js

// Fungsi untuk menginisialisasi pool, client, dan BARU: useRedisSession flag
const initAuthRoutes = (pool, client, useRedis) => {
    mysqlPool = pool;
    redisClient = client;
    useRedisSession = useRedis; // BARU: Simpan nilai flag
};

// Middleware untuk memverifikasi JWT
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ message: 'Token tidak disediakan' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Format token tidak valid' });
    }

    jwt.verify(token, process.env.JWT_SECRET, async(err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token tidak valid atau kadaluarsa' });
        }

        // BARU: Lakukan cek Redis HANYA JIKA useRedisSession true
        if (useRedisSession && redisClient) { // Tambahkan juga cek redisClient tidak null
            const storedSessionDataString = await redisClient.get(`session:${user.id}`);

            if (!storedSessionDataString) {
                // Pesan lebih spesifik untuk membantu debugging
                return res.status(403).json({ message: 'Session tidak ditemukan atau sudah kadaluarsa (dari Redis)' });
            }

            let storedSessionData;
            try {
                storedSessionData = JSON.parse(storedSessionDataString);
            } catch (parseError) {
                console.error('Error parsing session data from Redis:', parseError);
                return res.status(403).json({ message: 'Data session di Redis rusak' });
            }

            if (storedSessionData.token !== token) {
                // Pesan lebih spesifik
                return res.status(403).json({ message: 'Token tidak cocok dengan session yang tersimpan (dari Redis)' });
            }
        } else {
            // BARU: Log jika mode MySQL aktif dan tidak melakukan cek Redis
            console.log('Mode Sesi MySQL Aktif, tidak melakukan cek session di Redis.');
        }

        req.user = user;
        next();
    });
};

// Endpoint Login
router.post('/login', async(req, res) => {
    const { username, password, data_sensor_1 } = req.body;

    if (!username || !password || typeof data_sensor_1 === 'undefined' || isNaN(data_sensor_1)) {
        return res.status(400).json({ message: 'Username, password, dan data_sensor_1 (harus angka) diperlukan' });
    }

    try {
        const [users] = await mysqlPool.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length === 0) {
            return res.status(401).json({ message: 'Username atau password salah' });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Username atau password salah' });
        }

        const payload = {
            id: user.id,
            username: user.username,
            data_sensor_1: parseFloat(data_sensor_1)
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        // BARU: Simpan session di Redis HANYA JIKA useRedisSession true
        if (useRedisSession && redisClient) { // Tambahkan juga cek redisClient tidak null
            const sessionData = {
                token: token,
                loggedInAt: new Date().toISOString(),
                data_sensor_1: parseFloat(data_sensor_1)
            };
            await redisClient.set(`session:${user.id}`, JSON.stringify(sessionData), 'EX', 3600);
            console.log(`Session untuk user ${user.username} disimpan di Redis.`);
        } else {
            // BARU: Log jika mode MySQL aktif dan tidak menyimpan session di Redis
            console.log(`Mode Sesi MySQL Aktif, tidak menyimpan session di Redis.`);
        }

        // --- Bagian Menyimpan data_sensor_1 ke MySQL (tetap dilakukan) ---
        try {
            const sensorType = 'data_sensor_1';
            const sensorValue = parseFloat(data_sensor_1);

            await mysqlPool.query(
                'INSERT INTO sensor_readings (user_id, sensor_type, sensor_value) VALUES (?, ?, ?)', [user.id, sensorType, sensorValue]
            );
            console.log(`Data sensor ${sensorType}: ${sensorValue} untuk user ${user.username} berhasil disimpan ke MySQL.`);
        } catch (dbError) {
            console.error('Gagal menyimpan data sensor ke MySQL:', dbError);
        }
        // --- Akhir Bagian Menyimpan data_sensor_1 ke MySQL ---

        res.status(200).json({ message: 'Login berhasil', token, data_sensor_1: parseFloat(data_sensor_1) });

    } catch (error) {
        console.error('Error saat login:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = { router, verifyToken, initAuthRoutes };