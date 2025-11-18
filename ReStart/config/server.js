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

function getAllTags(callback) {
    database.query("SELECT tagName FROM tags ORDER BY tagName", (err, results) => {
        if (err) return callback(err);
        // Map results to a simple array of tag names
        const tags = results.map(row => row.tagName);
        callback(null, tags);
    });
}
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

// server.js (Updated app.get("/") route)

app.get("/", (req, res) => {
    const loggedInUser = req.user || null;

    // 1. Fetch all available tags first
    getAllTags((tagErr, availableTags) => {
        if (tagErr) {
            console.error("Error fetching tags:", tagErr);
            availableTags = []; // Fail gracefully if tags query breaks
        }

        // 2. Define and execute the works query (existing logic)
        const topWorksQuery = `
            SELECT 
                w.id,                                   
                w.image_path, 
                w.title,                           /* <-- ADDED */
                w.description,                     /* <-- ADDED */
                u.username AS username,          
                COUNT(l.work_id) AS like_count,
                GROUP_CONCAT(t.tagName) AS tags    /* <-- ADDED: Aggregate tags into a string */
            FROM 
                works w
            LEFT JOIN 
                likes l ON w.id = l.work_id
            JOIN 
                users u ON w.user_id = u.id
            LEFT JOIN                               /* <-- ADDED JOIN for tags */
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
                console.log("TOP WORKS ERROR:", err);
                return res.render("index", {
                    title: "Home",
                    user: loggedInUser,
                    works: [],
                    tags: availableTags // Still pass the tags even if works fail
                });
            }

            const processedWorks = works.map(work => ({
                ...work,
                isLiked: work.is_liked > 0,
                tags: work.tags ? work.tags.split(','):[]
            }));

            // Success case: Pass the actual array of tags
            res.render("index", {
                title: "Home",
                user: loggedInUser,
                works: processedWorks,
                tags: availableTags // <--- NOW PASSING THE ARRAY!
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
             getAllTags((tagErr, availableTags) => {
        if (tagErr) {
            console.error("Error fetching tags for profile:", tagErr);
            availableTags = [];
        }
            // Get all uploaded works for this user, including their like status.
            // Using a subquery to check if the current user has liked the work.
            const worksQuery = `
                SELECT 
                    w.id, 
                    w.image_path, 
                    w.title,                           /* <-- ADDED */
                    w.description,                     /* <-- ADDED */
                    (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked,
                    GROUP_CONCAT(t.tagName) AS tags    /* <-- ADDED: Aggregate tags into a string */
                FROM 
                    works w
                LEFT JOIN                               /* <-- ADDED JOIN for tags */
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
                    // ... (error handling)

                    const processedWorks = works.map(work => ({
                        id: work.id,
                        image_path: work.image_path,
                        username : user.username,
                        isLiked: work.is_liked > 0,
                        title: work.title,
                        description: work.description,
                        tags: work.tags ? work.tags.split(',') : [] /* <-- ADDED processing for tags */
                    }));
                    res.render("profile", {
                        title: "Profile",
                        user,
                        works: processedWorks, 
                        tags: availableTags// Use the processed works list
                    });
                }
            );
        }
    );
});
});

//-------------------------------------
// AJAX API: FETCH WORK AND COMMENTS (NEW ROUTE)
//-------------------------------------
// server.js

//-------------------------------------
// AJAX API: FETCH WORK AND COMMENTS (UPDATED ROUTE)
//-------------------------------------
app.get("/api/work-details/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const currentUserId = req.user.id;
    
    // 1. Query the work details, like status, poster's username, TITLE, DESCRIPTION, and TAGS
    const workQuery = `
        SELECT 
            w.id, 
            w.image_path, 
            w.title,                           /* <-- ADDED */
            w.description,                     /* <-- ADDED */
            u.username AS username,
            (SELECT COUNT(*) FROM likes WHERE work_id = w.id AND user_id = ?) AS is_liked,
            GROUP_CONCAT(t.tagName) AS tags    /* <-- ADDED: Aggregate tags into a string */
        FROM works w
        JOIN users u ON w.user_id = u.id
        LEFT JOIN
            work_tags wt ON w.id = wt.work_id  /* <-- ADDED JOIN */
        LEFT JOIN 
            tags t ON wt.tag_id = t.id         /* <-- ADDED JOIN */
        WHERE w.id = ?
        GROUP BY 
            w.id, w.image_path, w.title, w.description, u.username /* <-- ADDED GROUPING */
        `;

    // 2. Query all comments for the work (No change needed here)
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
        // Process tags: Convert the comma-separated string from GROUP_CONCAT into an array
        work.tags = work.tags ? work.tags.split(',') : []; /* <-- ADDED processing for tags */


        database.query(commentsQuery, [workId], (err, comments) => {
            if (err) {
                console.log("COMMENTS FETCH ERROR:", err);
                comments = [];
            }

            // Return all data as JSON
            res.json({
                success: true,
                work: work, // Now includes title, description, and tags array
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
//-------------------------------------
// Post (UPDATED to handle TAGS)
//-------------------------------------
app.post("/upload", requireAuth, upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");

    const imagePath = `/projects/${req.file.filename}`;
    const title = req.body.title;
    const description = req.body.description;
    // Get tags as an array (even if only one is selected, express converts it to an array if multiple are selected)
    const submittedTags = Array.isArray(req.body.tags) ? req.body.tags : (req.body.tags ? [req.body.tags] : []);
    
    // Find user ID by email
    database.query(
        "SELECT id FROM users WHERE email = ?",
        [req.user.email],
        (err, result) => {
            if (err || result.length === 0) return res.status(500).send("User not found");

            const userId = result[0].id;

            // 1. Save uploaded work into the 'works' table
            database.query(
                "INSERT INTO works (user_id, image_path, title, description) VALUES (?, ?, ?, ?)",
                [userId, imagePath, title, description],
                (err, workResult) => {
                    if (err) {
                        console.log("WORK INSERT DATABASE ERROR:", err);
                        return res.status(500).send("Database error: " + err.message); 
                    }
                    
                    const newWorkId = workResult.insertId;

                    // Skip tag processing if no tags were submitted
                    if (submittedTags.length === 0) {
                        return res.redirect("/profile");
                    }

                    // 2. Get the IDs for the submitted tag names
                    const tagNamesPlaceholder = submittedTags.map(() => '?').join(',');
                    const getTagIdQuery = `SELECT id FROM tags WHERE tagName IN (${tagNamesPlaceholder})`;

                    database.query(getTagIdQuery, submittedTags, (err, tagResults) => {
                        if (err) {
                            console.log("TAG ID FETCH ERROR:", err);
                            // Log error but continue to profile as the work is saved
                            return res.redirect("/profile");
                        }

                        // 3. Prepare values for bulk insertion into work_tags
                        const workTagsValues = tagResults.map(tag => [newWorkId, tag.id]);
                        
                        if (workTagsValues.length === 0) {
                            // No matching tags found, but work is saved
                            return res.redirect("/profile");
                        }

                        // 4. Insert work_id and tag_id pairs into the work_tags junction table
                        const insertWorkTagsQuery = "INSERT INTO work_tags (work_id, tag_id) VALUES ?";

                        database.query(insertWorkTagsQuery, [workTagsValues], (err) => {
                            if (err) {
                                console.log("WORK_TAGS INSERT ERROR:", err);
                                // Log error but continue to profile as the work is saved
                                return res.redirect("/profile");
                            }

                            // Success: Work and Tags saved
                            res.redirect("/profile");
                        });
                    });
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
// server.js

//-------------------------------------
// DELETE WORK (FIXED to handle foreign key constraints)
//-------------------------------------
app.delete("/delete/work/:id", requireAuth, (req, res) => {
    const workId = req.params.id;
    const userId = req.user.id;

    // 1. Delete all associated likes
    database.query("DELETE FROM likes WHERE work_id = ?", [workId], (err, result) => {
        if (err) {
            console.log("LIKE DELETE ERROR:", err);
            return res.status(500).json({ success: false, message: "Failed to delete associated likes." });
        }

        // 2. Delete all associated comments
        database.query("DELETE FROM comments WHERE work_id = ?", [workId], (err, result) => {
            if (err) {
                console.log("COMMENT DELETE ERROR:", err);
                return res.status(500).json({ success: false, message: "Failed to delete associated comments." });
            }
            database.query("DELETE FROM work_tags WHERE work_id = ?", [workId], (err, result) => {
                if (err) {
                    console.log("WORK_TAGS DELETE ERROR:", err);
                    return res.status(500).json({ success: false, message: "Failed to delete associated work tags." });
                }
            // 3. Delete the work itself (ensuring the user owns it)
            const deleteWorkQuery = "DELETE FROM works WHERE id = ? AND user_id = ?";

            database.query(deleteWorkQuery, [workId, userId], (err, result) => {
                if (err) {
                    console.log("WORK DELETE ERROR:", err);
                    return res.status(500).json({ success: false, message: "Failed to delete work due to server error." });
                }

                if (result.affectedRows === 0) {
                    // This means the work didn't exist OR the user didn't own it
                    return res.status(403).json({ success: false, message: "Work not found or unauthorized." });
                }

                // All deletions successful
                return res.json({ success: true, message: "Work and associated data deleted successfully.", workId: workId });
            });
            });
        });
    });
});


// server.js (Add this new route)

// -------------------------------------
// GET CATALOG PAGE (WITH TAG FILTERING)
// -------------------------------------
// server.js (Updated app.get("/catalog") route)

// -------------------------------------
// GET CATALOG PAGE (WITH MULTI-TAG FILTERING)
// -------------------------------------
app.get("/catalog", requireAuth, (req, res) => {
    // 1. Get the tag filter from the query parameter
    // Split the comma-separated string into an array, and filter out any empty strings
    let filterTags = [];
    if (req.query.tag) {
        // Lowercase and split the tag string.
        filterTags = req.query.tag.toLowerCase().split(',').filter(tag => tag.length > 0);
    }
    
    // The currently active tag (or the first one for display purposes if needed)
    const activeTag = filterTags.length > 0 ? filterTags[0] : null;

    const currentUserId = req.user.id; 

    // 2. Fetch all existing tags for the filter bar
    getAllTags((err, allTags) => {
        if (err) {
            console.error("Error fetching all tags:", err);
            allTags = []; 
        }

        // 3. Build the SQL query for works
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

        // Add filtering logic if multiple tags are selected
        if (filterTags.length > 0) {
            // Create a comma-separated string of '?' placeholders for the IN clause
            const placeholders = filterTags.map(() => '?').join(',');
            
            // The query must select works that have *all* selected tags.
            // This is done by checking if the work's ID appears in work_tags 
            // the same number of times as the number of filter tags (count(DISTINCT tag_id) = ?)
            worksQuery += `
                WHERE w.id IN (
                    SELECT work_id FROM work_tags 
                    JOIN tags ON work_tags.tag_id = tags.id 
                    WHERE tags.tagName IN (${placeholders})
                    GROUP BY work_id
                    HAVING COUNT(DISTINCT tags.id) = ? 
                )
            `;
            // Add all filter tags and the count to parameters
            queryParams.push(...filterTags, filterTags.length);
        }
        
        worksQuery += `
            GROUP BY 
                w.id, w.image_path, w.title, w.description, u.username, w.uploaded_at
            ORDER BY 
                w.uploaded_at  DESC
        `;
        
        // 4. Execute the works query
        database.query(worksQuery, queryParams, (err, works) => {
            if (err) {
                console.error("Error fetching works for catalog:", err);
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

            // 5. Render the new catalog view
            res.render("catalog", {
                title: "Work Catalog",
                works: processedWorks,
                allTags: allTags, 
                // We are passing filterTags as a comma-separated string to activeTag
                // so the EJS can correctly identify which tags are active, or a single tag name for existing EJS logic.
                // The current EJS only expects a single activeTag name for highlighting the first button.
                activeTag: activeTag, // Active tag will still only highlight the first tag button in the EJS
                user: req.user
            });
        });
    });
});

app.get("/profile/:username", requireAuth, (req, res) =>
{
    // 1. Get the target username from the URL parameter
    const targetUsername = req.params.username;

    // 2. Update the query to search by username
    database.query(
        "SELECT id, username, email FROM users WHERE username = ?",
        [targetUsername], // Use the targetUsername here
        (err, result) => {
            if (err || result.length === 0) {
                // Handle case where user is not found
                return res.status(404).render("404", { title: "User Not Found" });
            }

            const user = result[0]; // This is the profile owner's data
            getAllTags((tagErr, availableTags) => {
                if (tagErr) {
                    console.error("Error fetching tags for profile:", tagErr);
                    availableTags = [];
                }

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
                    [req.user.id, user.id], // req.user.id is for *current* user's like status, user.id is for *profile owner's* works
                    (err, works) => {
                        // ... (rest of your code)
                        const processedWorks = works.map(work => ({
                            id: work.id,
                            image_path: work.image_path,
                            username : user.username, // Profile owner's username
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
// server.js (Corrected app.get("/offers") route)

app.get("/offers", requireAuth, (req, res) => {
    const query = "SELECT id, title, description, company_name, contact_email, salary_range, date_posted FROM offers ORDER BY date_posted DESC";
    
    // The res.render call MUST be inside the database.query callback
    // because the database operation is asynchronous.
    database.query(query, (err, results) => {
        let offers = []; // Initialize offers here

        if (err) {
            console.error("Error fetching offers:", err);
            // On error, pass an empty array to prevent the page from crashing
            offers = [];
        } else {
            offers = results; // Set offers to the fetched results
        }
        
        // Render the page only after the database results are ready (or failed)
        res.render("offers", { 
            title: "Job Offers",
            user: req.user, 
            offers: offers 
        });
    });
});

// server.js (Insert this route after app.get("/offers"))

// -------------------------------------
// NEW: POST route to handle modal form submission
// -------------------------------------
app.post("/add-offer", requireAuth, (req, res) => {
    // req.body contains the form data 
    const { title, description, company_name, contact_email, salary_range } = req.body;

    // Basic validation
    if (!title || !description || !company_name || !contact_email) {
        // Simple error response if essential fields are missing
        return res.status(400).send("Missing required fields: Title, Company Name, Description, and Contact Email are required.");
    }

    const query = `
        INSERT INTO offers 
        (title, description, company_name, contact_email, salary_range) 
        VALUES (?, ?, ?, ?, ?)
    `;
    
    database.query(
        query, 
        [title, description, company_name, contact_email, salary_range || null], // Pass null if salary_range is empty
        (err, result) => {
            if (err) {
                console.error("OFFER INSERT ERROR:", err);
                return res.status(500).send("Failed to submit offer due to a database error.");
            }
            // Redirect back to the offers list after successful submission
            // This reloads the page, closing the modal and displaying the new offer.
            res.redirect("/offers");
        }
    );
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
