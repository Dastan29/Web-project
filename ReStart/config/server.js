require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const database = require("../database");
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

const profileStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/profile_pics/");
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + "-profile-" + Math.round(Math.random() * 1E9);
        cb(null, uniqueName + path.extname(file.originalname));
    }
});

const profileUpload = multer({ storage: profileStorage });
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

function getAllTags(callback) {
    database.query("SELECT tagName FROM tags ORDER BY tagName", (err, results) => {
        if (err) return callback(err);
        const tags = results.map(row => row.tagName);
        callback(null, tags);
    });
}

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
    const loggedInUser = req.user || null;

    getAllTags((tagErr, availableTags) => {
        if (tagErr) availableTags = [];

        const topWorksQuery = `
            SELECT 
                w.id,
                w.image_path, 
                w.title,
                w.description,
                u.username AS username,
                COUNT(l.work_id) AS like_count,
                GROUP_CONCAT(t.tagName) AS tags
            FROM 
                works w
            LEFT JOIN 
                likes l ON w.id = l.work_id
            JOIN 
                users u ON w.user_id = u.id
            LEFT JOIN
                work_tags wt ON w.id = wt.work_id
            LEFT JOIN 
                tags t ON wt.tag_id = t.id
            GROUP BY 
                w.id, w.image_path, w.title, w.description, u.username  
            ORDER BY 
                like_count DESC
            LIMIT 12
        `;

        database.query(topWorksQuery, (err, works) => {
            if (err) {
                return res.render("index", {
                    title: "Home",
                    user: loggedInUser,
                    works: [],
                    tags: availableTags
                });
            }

            const processedWorks = works.map(work => ({
                ...work,
                isLiked: work.is_liked > 0,
                tags: work.tags ? work.tags.split(',') : []
            }));

            res.render("index", {
                title: "Home",
                user: loggedInUser,
                works: processedWorks,
                tags: availableTags
            });
        });
    });
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
            if (err) return res.send("Login error: " + err.message);
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
            if (err) return res.send("Registration failed: " + err.sqlMessage);
            res.redirect("/login");
        }
    );
});

app.get("/profile", requireAuth, (req, res) => {
    database.query(
        "SELECT id, username, email, profile_pic, bio FROM users WHERE email = ?",
        [req.user.email],
        (err, result) => {
            if (err || result.length === 0) return res.redirect("/login");

            const user = result[0];
            getAllTags((tagErr, availableTags) => {
                if (tagErr) availableTags = [];

                const worksQuery = `
                    SELECT 
                        w.id, 
                        w.image_path, 
                        w.title,
                        w.description,
                        (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked,
                        GROUP_CONCAT(t.tagName) AS tags
                    FROM 
                        works w
                    LEFT JOIN
                        work_tags wt ON w.id = wt.work_id
                    LEFT JOIN 
                        tags t ON wt.tag_id = t.id
                    WHERE 
                        w.user_id = ?
                    GROUP BY
                        w.id, w.image_path, w.title, w.description
                `;

                database.query(
                    worksQuery,
                    [req.user.id, user.id],
                    (err, works) => {
                        const processedWorks = works.map(work => ({
                            id: work.id,
                            image_path: work.image_path,
                            username: user.username,
                            isLiked: work.is_liked > 0,
                            title: work.title,
                            description: work.description,
                            tags: work.tags ? work.tags.split(',') : []
                        }));

                        res.render("profile", {
                            title: "Profile",
                            user,
                            works: processedWorks,
                            tags: availableTags
                        });
                    }
                );
            });
        }
    );
});

app.post("/profile/update", requireAuth, profileUpload.single("profile_pic"), (req, res) => {
    const userId = req.user.id;
    const bio = req.body.bio;
    let imagePath = null;

    if (req.file) {
        imagePath = `/profile-pics/${req.file.filename}`;
    }

    let query = "UPDATE users SET ";
    let updates = [];
    let params = [];

    if (imagePath) {
        updates.push("profile_pic = ?");
        params.push(imagePath);
    }
    
    if (bio !== undefined) {
        updates.push("bio = ?");
        params.push(bio);
    }

    if (updates.length === 0) {
        return res.redirect("/profile");
    }

    query += updates.join(", ") + " WHERE id = ?";
    params.push(userId);

    database.query(query, params, (err, result) => {
        if (err) return res.status(500).send("Failed to update profile.");
        res.redirect("/profile");
    });
});

app.get("/api/work-details/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const currentUserId = req.user.id;
    
    const workQuery = `
        SELECT 
            w.id, 
            w.image_path, 
            w.title,
            w.description,
            u.username AS username,
            (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked,
            GROUP_CONCAT(t.tagName) AS tags
        FROM works w
        JOIN users u ON w.user_id = u.id
        LEFT JOIN
            work_tags wt ON w.id = wt.work_id
        LEFT JOIN 
            tags t ON wt.tag_id = t.id
        WHERE w.id = ?
        GROUP BY 
            w.id, w.image_path, w.title, w.description, u.username
    `;

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
            return res.status(404).json({ success: false, message: "Work not found." });
        }
        
        const work = workResults[0];
        work.isLiked = work.is_liked > 0;
        work.tags = work.tags ? work.tags.split(',') : [];

        database.query(commentsQuery, [workId], (err, comments) => {
            if (err) comments = [];

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
    const title = req.body.title;
    const description = req.body.description;
    const submittedTags = Array.isArray(req.body.tags) ? req.body.tags : (req.body.tags ? [req.body.tags] : []);
    
    database.query(
        "SELECT id FROM users WHERE email = ?",
        [req.user.email],
        (err, result) => {
            if (err || result.length === 0) return res.status(500).send("User not found");

            const userId = result[0].id;

            database.query(
                "INSERT INTO works (user_id, image_path, title, description) VALUES (?, ?, ?, ?)",
                [userId, imagePath, title, description],
                (err, workResult) => {
                    if (err) {
                        return res.status(500).send("Database error: " + err.message); 
                    }
                    
                    const newWorkId = workResult.insertId;

                    if (submittedTags.length === 0) {
                        return res.redirect("/profile");
                    }

                    const tagNamesPlaceholder = submittedTags.map(() => '?').join(',');
                    const getTagIdQuery = `SELECT id FROM tags WHERE tagName IN (${tagNamesPlaceholder})`;

                    database.query(getTagIdQuery, submittedTags, (err, tagResults) => {
                        if (err) {
                            return res.redirect("/profile");
                        }

                        const workTagsValues = tagResults.map(tag => [newWorkId, tag.id]);
                        
                        if (workTagsValues.length === 0) {
                            return res.redirect("/profile");
                        }

                        const insertWorkTagsQuery = "INSERT INTO work_tags (work_id, tag_id) VALUES ?";

                        database.query(insertWorkTagsQuery, [workTagsValues], (err) => {
                            if (err) {
                                return res.redirect("/profile");
                            }

                            res.redirect("/profile");
                        });
                    });
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

app.delete("/delete/work/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const userId = req.user.id;

    database.query("DELETE FROM likes WHERE work_id = ?", [workId], (err) => {
        if (err) {
            return res.status(500).json({ success: false, message: "Failed to delete associated likes." });
        }

        database.query("DELETE FROM comments WHERE work_id = ?", [workId], (err) => {
            if (err) {
                return res.status(500).json({ success: false, message: "Failed to delete associated comments." });
            }

            database.query("DELETE FROM work_tags WHERE work_id = ?", [workId], (err) => {
                if (err) {
                    return res.status(500).json({ success: false, message: "Failed to delete associated work tags." });
                }

                const deleteWorkQuery = "DELETE FROM works WHERE id = ? AND user_id = ?";

                database.query(deleteWorkQuery, [workId, userId], (err, result) => {
                    if (err) {
                        return res.status(500).json({ success: false, message: "Failed to delete work due to server error." });
                    }

                    if (result.affectedRows === 0) {
                        return res.status(403).json({ success: false, message: "Work not found or unauthorized." });
                    }

                    return res.json({ success: true, message: "Work and associated data deleted successfully.", workId: workId });
                });
            });
        });
    });
});

app.get("/catalog", requireAuth, (req, res) => {
    let filterTags = [];
    if (req.query.tag) {
        filterTags = req.query.tag.toLowerCase().split(',').filter(tag => tag.length > 0);
    }
    
    const activeTag = filterTags.length > 0 ? filterTags[0] : null;
    const currentUserId = req.user.id;

    getAllTags((err, allTags) => {
        if (err) allTags = [];

        let worksQuery = `
            SELECT 
                w.id,
                w.image_path,
                w.title,
                w.description,
                w.uploaded_at,
                u.username AS username,
                (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked,
                GROUP_CONCAT(t.tagName) AS tags
            FROM 
                works w
            JOIN 
                users u ON w.user_id = u.id
            LEFT JOIN
                work_tags wt ON w.id = wt.work_id
            LEFT JOIN 
                tags t ON wt.tag_id = t.id
        `;
        
        let queryParams = [currentUserId];

        if (filterTags.length > 0) {
            const placeholders = filterTags.map(() => '?').join(',');
            
            worksQuery += `
                WHERE w.id IN (
                    SELECT work_id FROM work_tags 
                    JOIN tags ON work_tags.tag_id = tags.id 
                    WHERE tags.tagName IN (${placeholders})
                    GROUP BY work_id
                    HAVING COUNT(DISTINCT tags.id) = ? 
                )
            `;
            queryParams.push(...filterTags, filterTags.length);
        }
        
        worksQuery += `
            GROUP BY 
                w.id, w.image_path, w.title, w.description, u.username, w.uploaded_at
            ORDER BY 
                w.uploaded_at DESC
        `;
        
        database.query(worksQuery, queryParams, (err, works) => {
            if (err) {
                return res.status(500).render("index", { 
                    title: "Catalog Error", 
                    works: [],
                    tags: allTags, 
                    user: req.user
                });
            }

            const processedWorks = works.map(work => ({
                ...work,
                isLiked: work.is_liked > 0,
                tags: work.tags ? work.tags.split(',') : []
            }));

            res.render("catalog", {
                title: "Work Catalog",
                works: processedWorks,
                allTags: allTags,
                activeTag: activeTag,
                user: req.user
            });
        });
    });
});

app.get("/profile/:username", requireAuth, (req, res) => {
    const targetUsername = req.params.username;

    database.query(
        "SELECT id, username, email, bio FROM users WHERE username = ?",
        [targetUsername],
        (err, result) => {
            if (err || result.length === 0) {
                return res.status(404).render("404", { title: "User Not Found" });
            }

            const user = result[0];
            getAllTags((tagErr, availableTags) => {
                if (tagErr) availableTags = [];

                const worksQuery = `
                    SELECT 
                        w.id, 
                        w.image_path, 
                        w.title, 
                        w.description, 
                        (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked,
                        GROUP_CONCAT(t.tagName) AS tags 
                    FROM 
                        works w
                    LEFT JOIN 
                        work_tags wt ON w.id = wt.work_id
                    LEFT JOIN 
                        tags t ON wt.tag_id = t.id
                    WHERE 
                        w.user_id = ?
                    GROUP BY
                        w.id, w.image_path, w.title, w.description
                `;

                database.query(
                    worksQuery,
                    [req.user.id, user.id],
                    (err, works) => {
                        const processedWorks = works.map(work => ({
                            id: work.id,
                            image_path: work.image_path,
                            username: user.username,
                            isLiked: work.is_liked > 0,
                            title: work.title,
                            description: work.description,
                            tags: work.tags ? work.tags.split(',') : []
                        }));

                        res.render("profileNotOwner", {
                            title: user.username + "'s Profile",
                            user,
                            works: processedWorks, 
                            tags: availableTags
                        });
                    }
                );
            });
        }
    );
});

app.get("/offers", requireAuth, (req, res) => {
    const query = "SELECT id, title, description, company_name, contact_email, salary_range, date_posted FROM offers ORDER BY date_posted DESC";
    
    database.query(query, (err, results) => {
        let offers = [];

        if (!err) offers = results;
        
        res.render("offers", { 
            title: "Job Offers",
            user: req.user, 
            offers: offers 
        });
    });
});
