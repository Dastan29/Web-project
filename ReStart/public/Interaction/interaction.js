// interaction.js

document.addEventListener('DOMContentLoaded', () => {
    console.log("Interaction script loaded. Modal and AJAX listeners active.");

    // --- Select the modal elements (these IDs must match the HTML you add below) ---
    const modal = document.getElementById('work-detail-modal');
    const modalContent = document.getElementById('modal-content');

// interaction.js - Inside the DOMContentLoaded wrapper

// -------------------------------------
// 1. MODAL OPEN/FETCH LOGIC
// -------------------------------------
document.body.addEventListener('click', async (event) => {
    // Check if the click was on the image link OR the new button
    const trigger = event.target.closest('.work-modal-trigger') || event.target.closest('.comment-modal-button');

    if (trigger) {
        event.preventDefault(); 
        
        // Use the workId from the trigger that was clicked
        const workId = trigger.dataset.workId;
        const url = `/api/work-details/${workId}`;
        
        try {
            // ... (rest of the fetch and renderModal function remains the same)
            const response = await fetch(url);
            const data = await response.json();

            if (data.success) {
                renderModal(data.work, data.comments);
                modal.style.display = 'flex'; // Show modal
            } else {
                alert('Could not load work details: ' + data.message);
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
            } else {
                alert('Could not process like/unlike action.');
            }
        } catch (error) {
            console.error('Like AJAX Error:', error);
        }
    });

    // -------------------------------------
    // 4. AJAX COMMENT SUBMISSION (from modal form)
    // -------------------------------------
    document.body.addEventListener('submit', async (event) => {
        const form = event.target.closest('.comment-form.modal-comment-form'); // Target the specific modal form

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

                } else {
                    alert('Failed to post comment: ' + data.message);
                }
            } catch (error) {
                console.error('Comment AJAX Error:', error);
            }
        }
    });


    
    
    // -------------------------------------
    // 5. RENDER MODAL CONTENT
    // -------------------------------------
    function renderModal(work, comments) {
        let commentsHtml = comments.map(c => 
            `<p><strong>${c.username}:</strong> ${c.content}</p>`
        ).join('');
        
        // This structure uses the requested two halves (left image, right comments)
        modalContent.innerHTML = `
            <div class="modal-left">
                <img src="${work.image_path}" alt="Work by ${work.poster_username}">
            </div>
            <div class="modal-right">
                <div class="modal-header">
                    <h4>Posted by: ${work.poster_username}</h4>
                    <span class="close-button">&times;</span>
                </div>
                
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
