require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const database = require("./database");
const multer = require("multer");

const app = express();



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


app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Essential for parsing JSON comments
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));



function requireAuth(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.redirect("/login");

    jwt.verify(token, process.env.SECRET_KEY, (err, user) => {
        if (err) return res.redirect("/login");
        req.user = user;
        next();
    });
}




app.get("/", (req, res) => {
    res.render("index", { title: "Home", user: null });
});

app.get("/login", (req, res) => {
    res.render("login", { title: "Login" });
});

app.get("/register", (req, res) => {
    res.render("register", { title: "Register" });
});



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




app.get("/profile", requireAuth, (req, res) => {
    database.query(
        "SELECT id, username, email FROM users WHERE email = ?",
        [req.user.email],
        (err, result) => {
            if (err || result.length === 0) return res.redirect("/login");

            const user = result[0];

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
                [req.user.id, user.id], 
                (err, works) => {
                    if (err) {
                        console.log("WORKS QUERY ERROR:", err);
                        works = [];
                    }
                    
                    const processedWorks = works.map(work => ({
                        id: work.id,
                        image_path: work.image_path,
                        isLiked: work.is_liked > 0 
                    }));
                    
                    res.render("profile", {
                        title: "Profile",
                        user,
                        works: processedWorks 
                    });
                }
            );
        }
    );
});



app.get("/api/work-details/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const currentUserId = req.user.id;
    
   
    const workQuery = `
        SELECT 
            w.id, 
            w.image_path, 
            u.username AS poster_username,
            (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked
        FROM works w
        JOIN users u ON w.user_id = u.id
        WHERE w.id = ?`;

    
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



app.post("/comment/:workId", requireAuth, (req, res) => {
    const workId = req.params.workId;
    const userId = req.user.id;
    const content = req.body.content; 

    if (!content || content.trim() === "") {
        return res.status(400).json({ success: false, message: "Comment content is required." });
    }
    
    
    database.query(
        "SELECT username FROM users WHERE id = ?",
        [userId],
        (userErr, userResults) => {
            const username = userResults[0].username || req.user.email; 

            database.query(
                "INSERT INTO comments (work_id, user_id, content) VALUES (?, ?, ?)",
                [workId, userId, content],
                (err, result) => {
                    if (err) {
                        console.log("COMMENT INSERT ERROR:", err);
                        return res.status(500).json({ success: false, message: "Failed to save comment." });
                    }

                    
                    return res.json({ 
                        success: true, 
                        message: "Comment added.",
                        comment: { 
                            content: content,
                            username: username 
                        }
                    });
                }
            );
        }
    );
});



app.get("/logout", (req, res) => {
    res.clearCookie("token");
    res.redirect("/");
});


app.post("/upload", requireAuth, upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");

    const imagePath = `/projects/${req.file.filename}`;
    const { title, description } = req.body;

    
    console.log("--- UPLOAD DEBUG ---");
    console.log("Received Title:", title);
    console.log("Received Description:", description);
    console.log("--------------------");
    

    
    database.query(
        "SELECT id FROM users WHERE email = ?",
        [req.user.email],
        (err, result) => {
            if (err || result.length === 0) return res.status(500).send("User not found");

            const userId = result[0].id;

            
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


app.post("/like/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const userId = req.user.id;
    let action = 'liked';

    
    database.query(
        "INSERT INTO likes (work_id, user_id) VALUES (?, ?)",
        [workId, userId],
        (err) => {
            if (err) {
                
                database.query(
                    "DELETE FROM likes WHERE work_id = ? AND user_id = ?",
                    [workId, userId],
                    (deleteErr) => {
                        if (deleteErr) {
                            console.log("DELETE LIKE ERROR:", deleteErr);
                            return res.status(500).json({ success: false, message: 'Toggle failed' });
                        }
                        action = 'unliked';
                        
                        return res.json({ success: true, action: action, workId: workId });
                    }
                );
                return;
            }
            
            return res.json({ success: true, action: action, workId: workId });
        }
    );
});




app.delete("/work/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const userId = req.user.id;

    
    const deleteQuery = "DELETE FROM works WHERE id = ? AND user_id = ?";

    database.query(deleteQuery, [workId, userId], (err, result) => {
        if (err) {
            console.log("WORK DELETE ERROR:", err);
            return res.status(500).json({ success: false, message: "Failed to delete work due to server error." });
        }

        if (result.affectedRows === 0) {
            
            return res.status(403).json({ success: false, message: "Work not found or unauthorized." });
        }

        
        return res.json({ success: true, message: "Work deleted successfully.", workId: workId });
    });
});


app.use((req, res) => {
    res.status(404).render("index", { title: "404 - Not Found" });
});



const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));