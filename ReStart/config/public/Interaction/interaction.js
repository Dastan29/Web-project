// interaction.js

document.addEventListener('DOMContentLoaded', () => {
    console.log("Interaction script loaded. Modal and AJAX listeners active.");

    // --- Select the modal elements ---
    const modal = document.getElementById('work-detail-modal');
    const modalContent = document.getElementById('modal-content');


// -------------------------------------
// 1. MODAL OPEN/FETCH LOGIC (Includes status check for robust fetching)
// -------------------------------------
document.body.addEventListener('click', async (event) => {
    // Check if the click was on the image link OR the new button
    const trigger = event.target.closest('.work-modal-trigger') || event.target.closest('.comment-modal-button');

    if (trigger) {
        event.preventDefault(); 
        
        const workId = trigger.dataset.workId;
        const url = `/api/work-details/${workId}`;
        
        try {
            const response = await fetch(url);
            
            // Check for non-OK status (e.g., 401, 404, 500)
            if (!response.ok) {
                 const errorBody = await response.text();
                 console.error('Server Error Status:', response.status);
                 console.error('Server Error Response (HTML Snippet):', errorBody.substring(0, 200) + '...');
                 alert(`Could not load work details. Server returned status ${response.status}. You might need to log in.`);
                 return;
            }

            const data = await response.json();

            if (data.success) {
                renderModal(data.work, data.comments);
                modal.style.display = 'flex'; // Show modal
            }
        } catch (error) {
            console.error('Modal Fetch Error:', error);
        }
    }
});
    
    // -------------------------------------
    // 2. MODAL CLOSE LOGIC
    // -------------------------------------
    document.body.addEventListener('click', (event) => {
        // Close if the background is clicked OR the close button is clicked
        if (event.target === modal || event.target.classList.contains('close-button')) {
            modal.style.display = 'none';
        }
    });

    // -------------------------------------
    // 3. AJAX LIKE TOGGLE (Handles both main page and modal buttons)
    // -------------------------------------
    document.body.addEventListener('click', async (event) => {
        const targetButton = event.target.closest('.like-button');
        if (!targetButton) return;
        event.preventDefault(); 
        
        const workId = targetButton.dataset.workId;
        const url = `/like/${workId}`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            const data = await response.json();

            if (data.success) {
                // Toggle the class on ALL like buttons for this work ID
                document.querySelectorAll(`[data-work-id="${workId}"].like-button`).forEach(btn => {
                    if (data.action === 'liked') {
                        btn.classList.add('liked'); 
                    } else {
                        btn.classList.remove('liked'); 
                    }
                });
            } 
        } catch (error) {
            console.error('Like AJAX Error:', error);
        }
    });

    // -------------------------------------
    // 4. AJAX COMMENT SUBMISSION (from modal form)
    // -------------------------------------
    document.body.addEventListener('submit', async (event) => {
        // Target the specific modal form using the combined selector
        const form = event.target.closest('.comment-form.modal-comment-form'); 

        if (form) {
            event.preventDefault(); 

            const workId = form.dataset.workId;
            const contentInput = form.querySelector('input[name="content"]');
            const content = contentInput.value.trim();
            const url = `/comment/${workId}`;

            if (!content) return;
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: content })
                });

                const data = await response.json();

                if (data.success) {
                    const commentsList = document.getElementById('modal-comments-list');
                    const username = data.comment.username || 'You'; 
                    
                    const newCommentElement = document.createElement('p');
                    newCommentElement.innerHTML = `<strong>${username}:</strong> ${data.comment.content}`; 
                    
                    if(commentsList) {
                        commentsList.appendChild(newCommentElement);
                    }
                    contentInput.value = ''; // Clear the input field

                } 
            } catch (error) {
                console.error('Comment AJAX Error:', error);
            }
        }
    });


    
    
    // -------------------------------------
    // 5. RENDER MODAL CONTENT (FIXED: tagsHtml is now defined)
    // -------------------------------------
    function renderModal(work, comments) {
        // 1. Generate HTML for comments
        let commentsHtml = comments.map(c => 
            `<p><strong>${c.username}:</strong> ${c.content}</p>`
        ).join('');
        
        // 2. Generate HTML for tags - **THIS FIXES THE REFERENCE ERROR**
        const tagsHtml = work.tags && work.tags.length > 0
            ? work.tags.map(tag => 
                // Ensure tag name is capitalized 
                `<span class="tag-label">${tag.charAt(0).toUpperCase() + tag.slice(1)}</span>`
              ).join('')
            : '';

        // 3. Populate the modal content with all variables
        modalContent.innerHTML = `
            <div class="modal-left">
                <img src="${work.image_path}" alt="Work by ${work.username}">
            </div>
            <div class="modal-right">
                <div class="modal-header">
                    <h3>${work.title}</h3> 
                    <span class="close-button">&times;</span>
                </div>
                
                <p class="modal-description">${work.description}</p>
                <div class="work-tags">${tagsHtml}</div>
                
                <h4>Posted by: ${work.username}</h4>
                
                <div class="modal-comments-list" id="modal-comments-list">
                    ${commentsHtml}
                </div>
                
                <div class="modal-footer">
                    <button 
                        type="button"
                        class="like-button ${work.isLiked ? 'liked' : ''}" 
                        data-work-id="${work.id}"
                        id="modal-like-button-${work.id}" 
                    >
                        Like
                    </button>
                    <form class="comment-form modal-comment-form" data-work-id="${work.id}">
                        <input type="text" name="content" placeholder="Add a comment..." required>
                        <button type="submit">Post</button>
                    </form>
                </div>
            </div>
        `;
    }

});


document.addEventListener('DOMContentLoaded', () => {
    // Select all delete buttons
    const deleteButtons = document.querySelectorAll('.delete-work-button');

    deleteButtons.forEach(button => {
        button.addEventListener('click', async (event) => {
            const workId = event.target.getAttribute('data-work-id');
            const deleteUrl = `/delete/work/${workId}`; // Matches your server.js route

            if (!confirm("Are you sure you want to delete this work? This cannot be undone.")) {
                return; // User cancelled the deletion
            }

            try {
                // Send a DELETE request using the fetch API
                const response = await fetch(deleteUrl, {
                    method: 'DELETE', // Crucial: must be 'DELETE'
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (data.success) {
                    // Success: Remove the work item from the DOM
                    const workItem = event.target.closest('.work-item');
                    if (workItem) {
                        workItem.remove();
                    }
                } 
            } catch (error) {
                console.error('Error deleting work:', error);
            }
        });
    });
});