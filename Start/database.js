const mysql = require("mysql2");

const database = mysql.createConnection({
    host: process.env.HOST,
    user: "root",
    password: "",
    database: process.env.DATA,
});

database.connect((err) => {
    if (err) console.log("DB ERROR:", err);
    else console.log("Database connected");
});

module.exports = database;
