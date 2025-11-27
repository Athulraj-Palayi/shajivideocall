// Socket.io connection
const socket = io();

// WebRTC configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// State
let localStream = null;
let screenStream = null;
let peerConnections = new Map();
let currentRoom = null;
let currentUserName = null;
let isAudioEnabled = true;
let isVideoEnabled = true;

// DOM elements
const landingPage = document.getElementById('landing-page');
const meetingRoom = document.getElementById('meeting-room');
const userNameInput = document.getElementById('userName');
const roomIdInput = document.getElementById('roomIdInput');
const createMeetingBtn = document.getElementById('createMeetingBtn');
const joinMeetingBtn = document.getElementById('joinMeetingBtn');
const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const currentRoomIdDisplay = document.getElementById('currentRoomId');
const participantCountDisplay = document.getElementById('participantCount');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const leaveMeetingBtn = document.getElementById('leaveMeetingBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const chatPanel = document.getElementById('chatPanel');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

// Initialize local media
async function initializeMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        localVideo.srcObject = localStream;
        return true;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please check permissions.');
        return false;
    }
}

// Create peer connection
function createPeerConnection(userId, userName) {
    const peerConnection = new RTCPeerConnection(configuration);

    // Add local tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        addVideoElement(userId, userName, remoteStream);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                to: userId
            });
        }
    };

    // Handle connection state
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${userName}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed') {
            removeVideoElement(userId);
        }
    };

    peerConnections.set(userId, peerConnection);
    return peerConnection;
}

// Add video element for remote peer
function addVideoElement(userId, userName, stream) {
    let videoContainer = document.getElementById(`video-${userId}`);

    if (!videoContainer) {
        videoContainer = document.createElement('div');
        videoContainer.id = `video-${userId}`;
        videoContainer.className = 'video-container';

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = stream;

        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = userName;

        const audioIndicator = document.createElement('div');
        audioIndicator.className = 'audio-indicator';

        videoContainer.appendChild(video);
        videoContainer.appendChild(label);
        videoContainer.appendChild(audioIndicator);
        videoGrid.appendChild(videoContainer);

        updateParticipantCount();
    }
}

// Remove video element
function removeVideoElement(userId) {
    const videoContainer = document.getElementById(`video-${userId}`);
    if (videoContainer) {
        videoContainer.remove();
        updateParticipantCount();
    }

    const peerConnection = peerConnections.get(userId);
    if (peerConnection) {
        peerConnection.close();
        peerConnections.delete(userId);
    }
}

// Update participant count
function updateParticipantCount() {
    const count = document.querySelectorAll('.video-container').length;
    participantCountDisplay.textContent = count;
}

// Create meeting
createMeetingBtn.addEventListener('click', async () => {
    const userName = userNameInput.value.trim();
    if (!userName) {
        alert('Please enter your name');
        return;
    }

    currentUserName = userName;

    if (await initializeMedia()) {
        socket.emit('create-room', (roomId) => {
            currentRoom = roomId;
            joinRoom(roomId);
        });
    }
});

// Join meeting
joinMeetingBtn.addEventListener('click', async () => {
    const userName = userNameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    if (!userName) {
        alert('Please enter your name');
        return;
    }

    if (!roomId) {
        alert('Please enter a meeting code');
        return;
    }

    currentUserName = userName;
    currentRoom = roomId;

    if (await initializeMedia()) {
        joinRoom(roomId);
    }
});

// Join room
function joinRoom(roomId) {
    socket.emit('join-room', { roomId, userName: currentUserName }, async (response) => {
        if (response.error) {
            alert(response.error);
            return;
        }

        // Switch to meeting room
        landingPage.classList.add('hidden');
        meetingRoom.classList.remove('hidden');
        currentRoomIdDisplay.textContent = roomId;

        // Connect to existing users
        for (const user of response.users) {
            await connectToNewUser(user.userId, user.userName);
        }
    });
}

// Connect to new user
async function connectToNewUser(userId, userName) {
    const peerConnection = createPeerConnection(userId, userName);

    // Create and send offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('offer', {
        offer: offer,
        to: userId
    });
}

// Socket event handlers
socket.on('user-connected', async ({ userId, userName }) => {
    console.log('User connected:', userName);
    // Wait for offer from new user
});

socket.on('offer', async ({ offer, from, userName }) => {
    const peerConnection = createPeerConnection(from, userName);

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', {
        answer: answer,
        to: from
    });
});

socket.on('answer', async ({ answer, from }) => {
    const peerConnection = peerConnections.get(from);
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', async ({ candidate, from }) => {
    const peerConnection = peerConnections.get(from);
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('user-disconnected', ({ userId, userName }) => {
    console.log('User disconnected:', userName);
    removeVideoElement(userId);
});

// Toggle microphone
toggleMicBtn.addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });

    toggleMicBtn.classList.toggle('active', isAudioEnabled);
    toggleMicBtn.querySelector('.icon-on').classList.toggle('hidden', !isAudioEnabled);
    toggleMicBtn.querySelector('.icon-off').classList.toggle('hidden', isAudioEnabled);
});

// Toggle video
toggleVideoBtn.addEventListener('click', () => {
    isVideoEnabled = !isVideoEnabled;
    localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideoEnabled;
    });

    toggleVideoBtn.classList.toggle('active', isVideoEnabled);
    toggleVideoBtn.querySelector('.icon-on').classList.toggle('hidden', !isVideoEnabled);
    toggleVideoBtn.querySelector('.icon-off').classList.toggle('hidden', isVideoEnabled);
});

// Share screen
shareScreenBtn.addEventListener('click', async () => {
    try {
        if (!screenStream) {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always'
                },
                audio: false
            });

            const screenTrack = screenStream.getVideoTracks()[0];

            // Replace video track in all peer connections
            peerConnections.forEach(peerConnection => {
                const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            });

            // Update local video
            localVideo.srcObject = screenStream;
            shareScreenBtn.classList.add('active');

            // Handle screen share stop
            screenTrack.onended = () => {
                stopScreenShare();
            };
        } else {
            stopScreenShare();
        }
    } catch (error) {
        console.error('Error sharing screen:', error);
    }
});

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    const videoTrack = localStream.getVideoTracks()[0];

    // Restore camera in all peer connections
    peerConnections.forEach(peerConnection => {
        const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
            sender.replaceTrack(videoTrack);
        }
    });

    localVideo.srcObject = localStream;
    shareScreenBtn.classList.remove('active');
}

// Toggle chat
toggleChatBtn.addEventListener('click', () => {
    chatPanel.classList.toggle('open');
    toggleChatBtn.classList.toggle('active');
});

closeChatBtn.addEventListener('click', () => {
    chatPanel.classList.remove('open');
    toggleChatBtn.classList.remove('active');
});

// Send chat message
function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message && currentRoom) {
        socket.emit('chat-message', {
            roomId: currentRoom,
            message: message
        });
        chatInput.value = '';
    }
}

sendMessageBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// Receive chat message
socket.on('chat-message', ({ userName, message, timestamp, userId }) => {
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message' + (userId === socket.id ? ' own' : '');

    const time = new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });

    messageElement.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-message-user">${userName}</span>
            <span class="chat-message-time">${time}</span>
        </div>
        <div class="chat-message-text">${escapeHtml(message)}</div>
    `;

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Copy meeting link
copyLinkBtn.addEventListener('click', () => {
    const url = `${window.location.origin}?room=${currentRoom}`;
    navigator.clipboard.writeText(url).then(() => {
        const originalHTML = copyLinkBtn.innerHTML;
        copyLinkBtn.innerHTML = '<span style="font-size: 12px;">Copied!</span>';
        setTimeout(() => {
            copyLinkBtn.innerHTML = originalHTML;
        }, 2000);
    });
});

// Leave meeting
leaveMeetingBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this meeting?')) {
        window.location.reload();
    }
});

// Utility function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Auto-join if room in URL
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        roomIdInput.value = roomParam;
    }
});
