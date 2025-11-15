require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const database = require("./database");
const multer = require("multer");
// Initialize Multer
const app = express();


// Configure storage for uploaded images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/projects/");
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9);
        cb(null, uniqueName + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Essential for parsing JSON comments
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
            if (err) {
                console.log("LOGIN ERROR:", err);
                return res.send("Login error: " + err.message);
            }
            if (results.length === 0) return res.send("User not found");

            const user = results[0];

            try {
                const match = await bcrypt.compare(password, user.password);
                if (!match) return res.send("Incorrect password");

                const token = jwt.sign(
                    { email: user.email, id: user.id },
                    process.env.SECRET_KEY,
                    { expiresIn: "1h" }
                );

                res.cookie("token", token);
                res.redirect("/profile");
            } catch (bcryptErr) {
                console.log("BCRYPT ERROR:", bcryptErr);
                return res.send("Authentication error: " + bcryptErr.message);
            }
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

            const user = result[0];

            // Get all uploaded works for this user, including their like status.
            // Using a subquery to check if the current user has liked the work.
            const worksQuery = `
                SELECT 
                    w.id, 
                    w.image_path, 
                    (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked
                FROM 
                    works w
                WHERE 
                    w.user_id = ?`;

            database.query(
                worksQuery,
                [req.user.id, user.id], // Current user ID for subquery, and profile user ID for WHERE
                (err, works) => {
                    if (err) {
                        console.log("WORKS QUERY ERROR:", err);
                        works = [];
                    }
                    // Transform the results: isLiked is 1 or 0, convert to boolean
                    const processedWorks = works.map(work => ({
                        id: work.id,
                        image_path: work.image_path,
                        isLiked: work.is_liked > 0 // Now a boolean
                    }));
                    
                    res.render("profile", {
                        title: "Profile",
                        user,
                        works: processedWorks // Use the processed works list
                    });
                }
            );
        }
    );
});


//-------------------------------------
// AJAX API: FETCH WORK AND COMMENTS (NEW ROUTE)
//-------------------------------------
app.get("/api/work-details/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const currentUserId = req.user.id;
    
    // 1. Query the work details and if the current user liked it, and the poster's username
    const workQuery = `
        SELECT 
            w.id, 
            w.image_path, 
            u.username AS poster_username,
            (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked
        FROM works w
        JOIN users u ON w.user_id = u.id
        WHERE w.id = ?`;

    // 2. Query all comments for the work, joining to get the username
    const commentsQuery = `
        SELECT 
            c.content, 
            c.created_at, 
            u.username
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.work_id = ?
        ORDER BY c.created_at ASC`;

    database.query(workQuery, [currentUserId, workId], (err, workResults) => {
        if (err || workResults.length === 0) {
            console.log("WORK FETCH ERROR:", err);
            return res.status(404).json({ success: false, message: "Work not found." });
        }
        
        const work = workResults[0];
        work.isLiked = work.is_liked > 0;

        database.query(commentsQuery, [workId], (err, comments) => {
            if (err) {
                console.log("COMMENTS FETCH ERROR:", err);
                comments = [];
            }

            // Return all data as JSON
            res.json({
                success: true,
                work: work,
                comments: comments
            });
        });
    });
});


//-------------------------------------
// COMMENTS - POST
//-------------------------------------
app.post("/comment/:workId", requireAuth, (req, res) => {
    const workId = req.params.workId;
    const userId = req.user.id;
    const content = req.body.content; // Expecting content from global express.json()

    if (!content || content.trim() === "") {
        return res.status(400).json({ success: false, message: "Comment content is required." });
    }
    
    // Find the current user's username to return in the JSON response
    database.query(
        "SELECT username FROM users WHERE id = ?",
        [userId],
        (userErr, userResults) => {
            const username = userResults[0].username || req.user.email; // Fallback to email

            database.query(
                "INSERT INTO comments (work_id, user_id, content) VALUES (?, ?, ?)",
                [workId, userId, content],
                (err, result) => {
                    if (err) {
                        console.log("COMMENT INSERT ERROR:", err);
                        return res.status(500).json({ success: false, message: "Failed to save comment." });
                    }

                    // Return the data needed to instantly display the new comment
                    return res.json({ 
                        success: true, 
                        message: "Comment added.",
                        comment: { 
                            content: content,
                            username: username // Now returning the actual username
                        }
                    });
                }
            );
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

// ... (omitted previous server.js code for brevity)

//-------------------------------------
// Post (UPDATED WITH DEBUG LOGGING)
//-------------------------------------
app.post("/upload", requireAuth, upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");

    const imagePath = `/projects/${req.file.filename}`;
    const { title, description } = req.body;

    // --- DEBUG LOGGING ---
    console.log("--- UPLOAD DEBUG ---");
    console.log("Received Title:", title);
    console.log("Received Description:", description);
    console.log("--------------------");
    // ---------------------

    // Find user ID by email
    database.query(
        "SELECT id FROM users WHERE email = ?",
        [req.user.email],
        (err, result) => {
            if (err || result.length === 0) return res.status(500).send("User not found");

            const userId = result[0].id;

            // Save uploaded work into the 'works' table
            database.query(
                "INSERT INTO works (user_id, image_path, title, description) VALUES (?, ?, ?, ?)",
                [userId, imagePath, title, description],
                (err) => {
                    if (err) {
                        console.log("DATABASE ERROR:", err);
                        return res.status(500).send("Database error: " + err.message); 
                    }
                    res.redirect("/profile");
                }
            );
        }
    );
});

// ... (omitted rest of server.js code)
//-------------------------------------
//Likes - UPDATED TO RESPOND WITH JSON
//-------------------------------------
app.post("/like/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const userId = req.user.id;
    let action = 'liked';

    // Try insert (LIKE)
    database.query(
        "INSERT INTO likes (work_id, user_id) VALUES (?, ?)",
        [workId, userId],
        (err) => {
            if (err) {
                // Already liked → remove like (UNLIKE)
                database.query(
                    "DELETE FROM likes WHERE work_id = ? AND user_id = ?",
                    [workId, userId],
                    (deleteErr) => {
                        if (deleteErr) {
                            console.log("DELETE LIKE ERROR:", deleteErr);
                            return res.status(500).json({ success: false, message: 'Toggle failed' });
                        }
                        action = 'unliked';
                        // SUCCESS response for UNLIKE
                        return res.json({ success: true, action: action, workId: workId });
                    }
                );
                return;
            }
            // SUCCESS response for LIKE
            return res.json({ success: true, action: action, workId: workId });
        }
    );
});



//-------------------------------------
// DELETE WORK
//-------------------------------------
app.delete("/work/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const userId = req.user.id;

    // First, verify the user owns the work
    // We delete from works, and use the work_id and user_id in the WHERE clause
    // to ensure only the owner can delete the work.
    const deleteQuery = "DELETE FROM works WHERE id = ? AND user_id = ?";

    database.query(deleteQuery, [workId, userId], (err, result) => {
        if (err) {
            console.log("WORK DELETE ERROR:", err);
            return res.status(500).json({ success: false, message: "Failed to delete work due to server error." });
        }

        if (result.affectedRows === 0) {
            // This means the work didn't exist OR the user didn't own it
            return res.status(403).json({ success: false, message: "Work not found or unauthorized." });
        }

        // Deletion successful
        return res.json({ success: true, message: "Work deleted successfully.", workId: workId });
    });
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