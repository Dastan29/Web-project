require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());

// EJS setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Dummy "database"
const users = [];

// Middleware to protect routes
function requireAuth(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.redirect("/login");

    jwt.verify(token, process.env.SECRET_KEY, (err, user) => {
        if (err) return res.redirect("/login");
        req.user = user;
        next();
    });
}

// Public Home Page
app.get("/", (req, res) => {
    res.render("index", { title: "Home", user: null });
});

// Protected Profile Page
app.get("/profile", requireAuth, (req, res) => {
    const user = users.find(u => u.email === req.user.email);
    if (!user) return res.redirect("/login");
    res.render("profile", { title: "Profile", user });
});

// Login & Register pages (public)
app.get("/login", (req, res) => res.render("login", { title: "Login" }));
app.get("/register", (req, res) => res.render("register", { title: "Register" }));

// Logout
app.get("/logout", (req, res) => {
    res.clearCookie("token");
    res.redirect("/");
});

// Registration
app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    users.push({ name: username, email, password: hash });
    res.redirect("/login");
});

// Login
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.send("User not found");

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Incorrect password");

    const token = jwt.sign({ email: user.email }, process.env.SECRET_KEY, { expiresIn: "1h" });
    res.cookie("token", token).redirect("/profile");
});

// 404 handler
app.use((req, res) => res.status(404).render("index", { title: "404 - Not Found" }));

// Start server
const PORT = process.env.PORT || 3025;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
