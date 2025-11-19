document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('work-detail-modal');
    const modalContent = document.getElementById('modal-content');

    document.body.addEventListener('click', async (event) => {
        const trigger = event.target.closest('.work-modal-trigger') || event.target.closest('.comment-modal-button');

        if (trigger) {
            event.preventDefault(); 
            
            const workId = trigger.dataset.workId;
            const url = `/api/work-details/${workId}`;
            
            try {
                const response = await fetch(url);
                
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
                    modal.style.display = 'flex';
                }
            } catch (error) {
                console.error('Modal Fetch Error:', error);
            }
        }
    });

    document.body.addEventListener('click', (event) => {
        if (event.target === modal || event.target.classList.contains('close-button')) {
            modal.style.display = 'none';
        }
    });

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

    document.body.addEventListener('submit', async (event) => {
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
                    contentInput.value = '';
                } 
            } catch (error) {
                console.error('Comment AJAX Error:', error);
            }
        }
    });

    function renderModal(work, comments) {
        let commentsHtml = comments.map(c => 
            `<p><strong>${c.username}:</strong> ${c.content}</p>`
        ).join('');
        
        const tagsHtml = work.tags && work.tags.length > 0
            ? work.tags.map(tag => 
                `<span class="tag-label">${tag.charAt(0).toUpperCase() + tag.slice(1)}</span>`
              ).join('')
            : '';

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
    const deleteButtons = document.querySelectorAll('.delete-work-button');

    deleteButtons.forEach(button => {
        button.addEventListener('click', async (event) => {
            const workId = event.target.getAttribute('data-work-id');
            const deleteUrl = `/delete/work/${workId}`;

            if (!confirm("Are you sure you want to delete this work? This cannot be undone.")) {
                return;
            }

            try {
                const response = await fetch(deleteUrl, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (data.success) {
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
