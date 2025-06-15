// Mengimpor library yang dibutuhkan
require('dotenv').config();
const express = require('express');
const Redis = require('ioredis');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs'); // Masih dibutuhkan untuk inisialisasi user dummy

// Mengimpor route yang sudah dipisahkan
const authRoutes = require('./routes/authRoutes');
const dataRoutes = require('./routes/dataRoutes');

// Membuat instance aplikasi Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware untuk mengurai body request dalam format JSON
app.use(express.json());

// =========================================================
// Konfigurasi Database (MySQL)
// =========================================================
const mysqlConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'iot_session_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let mysqlPool;

async function connectToMySQL() {
    try {
        mysqlPool = mysql.createPool(mysqlConfig);
        console.log('Terhubung ke MySQL database!');

        await mysqlPool.query('SELECT 1 + 1 AS solution');
        console.log('Verifikasi koneksi MySQL berhasil.');

        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL
            )
        `);
        console.log('Tabel "users" sudah dipastikan ada atau dibuat.');

        const [rows] = await mysqlPool.query('SELECT COUNT(*) as count FROM users WHERE username = ?', ['testuser']);
        if (rows[0].count === 0) {
            const hashedPassword = await bcrypt.hash('password123', 10);
            await mysqlPool.query('INSERT INTO users (username, password) VALUES (?, ?)', ['testuser', hashedPassword]);
            console.log('User "testuser" dengan hashed password "password123" ditambahkan (hanya untuk testing).');
        }

    } catch (error) {
        console.error('Gagal terhubung ke MySQL:', error);
        process.exit(1);
    }
}

// =========================================================
// Konfigurasi Redis
// =========================================================
// BARU: Ambil nilai USE_REDIS_SESSION dari variabel lingkungan
const USE_REDIS_SESSION = process.env.USE_REDIS_SESSION === 'true'; // Konversi string "true"/"false" ke boolean

const redisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
};

let redisClient; // Untuk menyimpan instance Redis client

function connectToRedis() {
    if (USE_REDIS_SESSION) { // Hanya terhubung ke Redis jika flag USE_REDIS_SESSION true
        redisClient = new Redis(redisConfig);

        redisClient.on('connect', () => {
            console.log('Terhubung ke Redis!');
        });

        redisClient.on('error', (err) => {
            console.error('Koneksi Redis error:', err);
            // Mungkin ingin menangani error ini lebih lanjut, misalnya mencoba reconnect
        });
    } else {
        console.log('Mode Sesi MySQL Aktif, tidak terhubung ke Redis.');
        redisClient = null; // Pastikan redisClient null jika tidak digunakan
    }
}

// =========================================================
// Routes (API Endpoints)
// =========================================================

// Contoh endpoint home
app.get('/', (req, res) => {
    res.send('Server IoT Session Management dengan Redis berjalan!');
});

// Menggunakan router yang dipisahkan
app.use('/auth', authRoutes.router); // Semua rute di authRoutes akan diawali dengan /auth
app.use('/api', dataRoutes.router);  // Semua rute di dataRoutes akan diawali dengan /api

// =========================================================
// Jalankan Server
// =========================================================

async function startServer() {
    await connectToMySQL(); // Tunggu sampai mysqlPool terinisialisasi
    connectToRedis();     // Tunggu sampai redisClient terinisialisasi (jika USE_REDIS_SESSION=true)

    // >>>>>> PENTING: Panggil inisialisasi router DI SINI <<<<<<
    // Ini memastikan mysqlPool dan redisClient sudah terinisialisasi dan tersedia
    authRoutes.initAuthRoutes(mysqlPool, redisClient, USE_REDIS_SESSION);
    dataRoutes.initDataRoutes(mysqlPool, redisClient, authRoutes.verifyToken, USE_REDIS_SESSION);

    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
    });
}

startServer();