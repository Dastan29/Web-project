const mysql = require("mysql2");

const pool = mysql.createPool({
    connectionLimit: 10,
    host: process.env.HOST,
    user: process.env.USER,
    password: process.env.SECRET_KEY,
    database: process.env.DATA,
});

pool.getConnection((err) => {
    if (err) console.log("DB ERROR:", err);
    else console.log("Database connected");
});

module.exports = pool;
