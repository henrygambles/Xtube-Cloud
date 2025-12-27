const state = {
  videos: [],
  currentVideo: null,
  user: null,
  viewed: new Set(),
};

const els = {
  player: document.getElementById('player'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  title: document.getElementById('video-title'),
  viewCount: document.getElementById('view-count'),
  uploadDate: document.getElementById('upload-date'),
  likeBtn: document.getElementById('like-btn'),
  dislikeBtn: document.getElementById('dislike-btn'),
  likeCount: document.getElementById('like-count'),
  dislikeCount: document.getElementById('dislike-count'),
  ratioFill: document.getElementById('ratio-fill'),
  ratioText: document.getElementById('ratio-text'),
  commentCount: document.getElementById('comment-count'),
  commentForm: document.getElementById('comment-form'),
  commentInput: document.getElementById('comment-input'),
  commentsList: document.getElementById('comments-list'),
  suggestedList: document.getElementById('suggested-list'),
  userStatus: document.getElementById('user-status'),
  profileThumb: document.getElementById('profile-thumb'),
  signupToggle: document.getElementById('signup-toggle'),
  loginToggle: document.getElementById('login-toggle'),
  logoutBtn: document.getElementById('logout-btn'),
  signupForm: document.getElementById('signup-form'),
  loginForm: document.getElementById('login-form'),
  profileForm: document.getElementById('profile-form'),
  profileFile: document.getElementById('profile-file'),
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  wireAuth();
  wirePlayer();
  loadUser().then(loadVideos);
  setInterval(loadVideos, 15000);
}

function wireAuth() {
  els.signupToggle.addEventListener('click', () => toggleCard(els.signupForm));
  els.loginToggle.addEventListener('click', () => toggleCard(els.loginForm));

  els.signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value;
    const user = await authRequest('/api/signup', { username, password });
    if (user) {
      state.user = user;
      renderUser();
      hideCards();
    }
  });

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const user = await authRequest('/api/login', { username, password });
    if (user) {
      state.user = user;
      renderUser();
      hideCards();
    }
  });

  els.logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    state.user = null;
    renderUser();
  });

  els.profileFile.addEventListener('change', async () => {
    const file = els.profileFile.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/profile-picture', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await res.json();
      if (data?.user) {
        state.user = data.user;
        renderUser();
      } else {
        alert(data?.error || 'Upload failed');
      }
    } catch (err) {
      console.error(err);
      alert('Upload failed');
    } finally {
      els.profileFile.value = '';
    }
  });
}

function hideCards() {
  [els.signupForm, els.loginForm, els.profileForm].forEach((card) => {
    card.classList.add('hidden');
  });
}

function toggleCard(card) {
  const isHidden = card.classList.contains('hidden');
  hideCards();
  if (isHidden) {
    card.classList.remove('hidden');
  }
}

function wirePlayer() {
  els.fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      els.player.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  els.likeBtn.addEventListener('click', () => react('like'));
  els.dislikeBtn.addEventListener('click', () => react('dislike'));

  els.commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.user) {
      alert('Please sign in to comment.');
      return;
    }
    const text = els.commentInput.value.trim();
    if (!text) return;
    const video = state.currentVideo;
    try {
      const res = await fetch(`/api/videos/${video.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.comment) {
        els.commentInput.value = '';
        loadComments(video);
      } else {
        alert(data?.error || 'Could not post comment');
      }
    } catch (err) {
      console.error(err);
    }
  });

  els.player.addEventListener('play', () => {
    if (state.currentVideo) {
      registerView(state.currentVideo);
    }
  });
}

async function loadUser() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    state.user = data.user;
  } catch (err) {
    console.error(err);
  } finally {
    renderUser();
  }
}

function renderUser() {
  if (state.user) {
    els.userStatus.textContent = state.user.username;
    els.logoutBtn.classList.remove('hidden');
    els.signupToggle.classList.add('hidden');
    els.loginToggle.classList.add('hidden');
    els.profileForm.classList.remove('hidden');
    if (state.user.profilePicUrl) {
      els.profileThumb.style.backgroundImage = `url(${state.user.profilePicUrl})`;
    } else {
      els.profileThumb.style.backgroundImage =
        'linear-gradient(135deg, rgba(255,0,51,0.4), rgba(255,0,51,0.1))';
    }
    els.commentInput.placeholder = 'Add a public comment...';
    els.commentInput.disabled = false;
    els.commentForm.querySelector('button').disabled = false;
  } else {
    els.userStatus.textContent = 'Not signed in';
    els.logoutBtn.classList.add('hidden');
    els.signupToggle.classList.remove('hidden');
    els.loginToggle.classList.remove('hidden');
    els.profileForm.classList.add('hidden');
    els.profileThumb.style.backgroundImage =
      'linear-gradient(135deg, #333, #111)';
    els.commentInput.placeholder = 'Sign in to comment.';
    els.commentInput.disabled = true;
    els.commentForm.querySelector('button').disabled = true;
  }
}

async function loadVideos() {
  try {
    const res = await fetch('/api/videos');
    const data = await res.json();
    state.videos = data.videos || [];
    if (!state.videos.length) {
      els.player.removeAttribute('src');
      els.title.textContent = 'Drop a video into the videos folder to get started.';
      els.viewCount.textContent = '';
      els.uploadDate.textContent = '';
      els.suggestedList.innerHTML =
        '<div class="muted">Add .mov/.mp4 files to populate the feed.</div>';
      els.commentsList.innerHTML = '';
      els.commentCount.textContent = '(0)';
      return;
    }

    const nextVideo =
      state.currentVideo &&
      state.videos.find((v) => v.id === state.currentVideo.id);

    if (nextVideo) {
      // Refresh metadata without resetting playback
      Object.assign(state.currentVideo, nextVideo);
      els.viewCount.textContent = `${formatCount(nextVideo.views)} views`;
      els.uploadDate.textContent = formatDate(nextVideo.uploadedAt);
      updateReactionUi(nextVideo.likes, nextVideo.dislikes);
      els.commentCount.textContent = `(${nextVideo.commentsCount || 0})`;
      renderSuggested();
      return;
    }

    setVideo(state.videos[0]);
  } catch (err) {
    console.error(err);
  }
}

function setVideo(video) {
  state.currentVideo = video;
  els.player.src = video.url;
  els.title.textContent = video.title;
  els.viewCount.textContent = `${formatCount(video.views)} views`;
  els.uploadDate.textContent = formatDate(video.uploadedAt);
  updateReactionUi(video.likes, video.dislikes);
  loadComments(video);
  renderSuggested();
}

function renderSuggested() {
  const others = state.videos.filter((v) => v.id !== state.currentVideo.id);
  if (!others.length) {
    els.suggestedList.innerHTML = '<div class="muted">No other videos yet.</div>';
    return;
  }
  els.suggestedList.innerHTML = '';
  others.forEach((video) => {
    const item = document.createElement('div');
    item.className = 'suggested-item';
    item.innerHTML = `
      <div class="thumb">.${video.filename.split('.').pop()}</div>
      <div>
        <p class="suggested-title">${video.title}</p>
        <div class="suggested-meta">${formatCount(video.views)} views • ${formatDate(
      video.uploadedAt
    )}</div>
      </div>
    `;
    item.addEventListener('click', () => setVideo(video));
    els.suggestedList.appendChild(item);
  });
}

async function loadComments(video) {
  try {
    const res = await fetch(`/api/videos/${video.id}/comments`);
    const data = await res.json();
    const comments = data.comments || [];
    els.commentCount.textContent = `(${comments.length})`;
    els.commentsList.innerHTML = '';
    if (!comments.length) {
      els.commentsList.innerHTML =
        '<div class="muted">Be the first to comment.</div>';
      return;
    }
    comments
      .slice()
      .reverse()
      .forEach((c) => {
        const div = document.createElement('div');
        div.className = 'comment';
        div.innerHTML = `
          <div><span class="comment-author">${escapeHtml(
            c.username
          )}</span><span class="comment-date">${formatDate(c.createdAt)}</span></div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        `;
        els.commentsList.appendChild(div);
      });
  } catch (err) {
    console.error(err);
  }
}

async function registerView(video) {
  if (state.viewed.has(video.id)) return;
  state.viewed.add(video.id);
  try {
    const res = await fetch(`/api/videos/${video.id}/view`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (typeof data.views === 'number') {
      video.views = data.views;
      if (state.currentVideo?.id === video.id) {
        els.viewCount.textContent = `${formatCount(video.views)} views`;
      }
    }
  } catch (err) {
    console.error(err);
  }
}

async function react(type) {
  const video = state.currentVideo;
  if (!video) return;
  try {
    const res = await fetch(`/api/videos/${video.id}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type }),
    });
    const data = await res.json();
    if (typeof data.likes === 'number') {
      video.likes = data.likes;
      video.dislikes = data.dislikes;
      updateReactionUi(video.likes, video.dislikes);
    }
  } catch (err) {
    console.error(err);
  }
}

function updateReactionUi(likes, dislikes) {
  els.likeCount.textContent = formatCount(likes || 0);
  els.dislikeCount.textContent = formatCount(dislikes || 0);
  const total = (likes || 0) + (dislikes || 0);
  const ratio = total === 0 ? 100 : Math.round((likes / total) * 100);
  els.ratioFill.style.width = `${ratio}%`;
  els.ratioText.textContent = `${ratio}% liked`;
}

async function authRequest(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.user) {
      return data.user;
    }
    alert(data.error || 'Auth failed');
    return null;
  } catch (err) {
    console.error(err);
    alert('Auth failed');
    return null;
  }
}

function formatCount(count) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

function formatDate(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
