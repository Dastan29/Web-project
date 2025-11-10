require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const database = require("./database");

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());

// EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));


// -------------------------------------
// AUTH MIDDLEWARE
// -------------------------------------
function requireAuth(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.redirect("/login");

    jwt.verify(token, process.env.SECRET_KEY, (err, user) => {
        if (err) return res.redirect("/login");
        req.user = user;
        next();
    });
}


// -------------------------------------
// PUBLIC ROUTES
// -------------------------------------

app.get("/", (req, res) => {
    res.render("index", { title: "Home", user: null });
});

app.get("/login", (req, res) => {
    res.render("login", { title: "Login" });
});

app.get("/register", (req, res) => {
    res.render("register", { title: "Register" });
});


// -------------------------------------
// LOGIN
// -------------------------------------
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    database.query(
        "SELECT * FROM users WHERE email = ?",
        [email],
        async (err, results) => {
            if (err) return res.send("Database error");
            if (results.length === 0) return res.send("User not found");

            const user = results[0];

            const match = await bcrypt.compare(password, user.password);
            if (!match) return res.send("Incorrect password");

            const token = jwt.sign(
                { email: user.email },
                process.env.SECRET_KEY,
                { expiresIn: "1h" }
            );

            res.cookie("token", token);
            res.redirect("/profile");
        }
    );
});


// -------------------------------------
// REGISTER
// -------------------------------------
app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);

    database.query(
        "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
        [username, email, hash],
        (err, result) => {
            if (err) {
                console.log("REGISTER ERROR:", err);
                return res.send("Registration failed: " + err.sqlMessage);
            }
            res.redirect("/login");
        }
    );
});


// -------------------------------------
// PROTECTED PROFILE PAGE
// -------------------------------------
app.get("/profile", requireAuth, (req, res) => {
    database.query(
        "SELECT id, username, email FROM users WHERE email = ?",
        [req.user.email],
        (err, result) => {
            if (err || result.length === 0) return res.redirect("/login");

            res.render("profile", {
                title: "Profile",
                user: result[0]
            });
        }
    );
});


// -------------------------------------
// LOGOUT
// -------------------------------------
app.get("/logout", (req, res) => {
    res.clearCookie("token");
    res.redirect("/");
});


// -------------------------------------
// 404
// -------------------------------------
app.use((req, res) => {
    res.status(404).render("index", { title: "404 - Not Found" });
});


// Start server
const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
