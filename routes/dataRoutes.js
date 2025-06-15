// routes/dataRoutes.js
const express = require('express');
const router = express.Router();

let mysqlPool;
let redisClient;

// let verifyTokenMiddleware; // Hapus ini, karena akan digunakan langsung dari parameter initDataRoutes
let useRedisSession = false;

// Fungsi untuk menginisialisasi pool, client, middleware, dan useRedisSession flag
const initDataRoutes = (pool, client, verifyToken, useRedis) => { // 'verifyToken' adalah parameter
    mysqlPool = pool;
    redisClient = client;
    // verifyTokenMiddleware = verifyToken; // Tidak perlu disimpan di variabel global
    useRedisSession = useRedis;

    // PENTING: Definisi route sekarang ada di dalam fungsi initDataRoutes
    // Ini memastikan bahwa 'verifyToken' sudah berupa fungsi ketika route ini diatur
    router.get('/protected-data', verifyToken, async(req, res) => { // Gunakan 'verifyToken' dari parameter
        const userId = req.user.id;
        const username = req.user.username;
        const dataSensor1FromJWT = req.user.data_sensor_1;

        let dataFromSource = null;
        let source = 'MySQL Database';

        if (useRedisSession && redisClient) {
            dataFromSource = await redisClient.get(`user_data:${userId}`);
            if (dataFromSource) {
                source = 'Redis Cache';
                console.log(`[GET /protected-data] Data untuk user ${username} diambil dari Redis (CACHE HIT).`);
                dataFromSource = JSON.parse(dataFromSource);
            }
        } else {
            console.log(`Mode Sesi MySQL Aktif, tidak memeriksa cache Redis.`);
        }

        if (!dataFromSource) {
            console.log(`[GET /protected-data] Data untuk user ${username} tidak ditemukan di Redis (atau mode MySQL), mengambil dari MySQL.`);
            const [results] = await mysqlPool.query('SELECT id, username FROM users WHERE id = ?', [userId]);

            let userProfileData = {};
            if (results.length > 0) {
                userProfileData = {
                    id: results[0].id,
                    username: results[0].username,
                    email: `${results[0].username}@example.com`,
                    role: 'user',
                };
                if (useRedisSession && redisClient) {
                    await redisClient.set(`user_data:${userId}`, JSON.stringify(userProfileData), 'EX', 300);
                    console.log(`[GET /protected-data] Data user ${username} disimpan ke Redis.`);
                }
            } else {
                console.warn(`[GET /protected-data] Data user ${username} tidak ditemukan di MySQL.`);
                return res.status(404).json({ message: 'Data pengguna tidak ditemukan.' });
            }
            dataFromSource = userProfileData;
        }

        dataFromSource.data_sensor_1_from_jwt = dataSensor1FromJWT;

        res.status(200).json({
            message: `Halo, ${username}! Ini data terproteksi Anda.`,
            source: source,
            data: dataFromSource
        });
    }); // Tutup router.get()
}; // Tutup initDataRoutes()

module.exports = { router, initDataRoutes };