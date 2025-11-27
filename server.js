const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static('public'));

// Store active rooms and users
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Generate unique room ID
    socket.on('create-room', (callback) => {
        const roomId = uuidv4().substring(0, 8);
        rooms.set(roomId, new Set([socket.id]));
        socket.join(roomId);
        console.log(`Room created: ${roomId}`);
        callback(roomId);
    });

    // Join existing room
    socket.on('join-room', ({ roomId, userName }, callback) => {
        if (!rooms.has(roomId)) {
            callback({ error: 'Room not found' });
            return;
        }

        socket.join(roomId);
        rooms.get(roomId).add(socket.id);
        socket.userName = userName;
        socket.roomId = roomId;

        // Notify others in the room
        socket.to(roomId).emit('user-connected', {
            userId: socket.id,
            userName: userName
        });

        // Send list of existing users to new user
        const existingUsers = Array.from(rooms.get(roomId))
            .filter(id => id !== socket.id)
            .map(id => {
                const sock = io.sockets.sockets.get(id);
                return {
                    userId: id,
                    userName: sock ? sock.userName : 'Unknown'
                };
            });

        callback({ success: true, users: existingUsers });
        console.log(`User ${userName} joined room ${roomId}`);
    });

    // WebRTC signaling
    socket.on('offer', ({ offer, to }) => {
        socket.to(to).emit('offer', {
            offer: offer,
            from: socket.id,
            userName: socket.userName
        });
    });

    socket.on('answer', ({ answer, to }) => {
        socket.to(to).emit('answer', {
            answer: answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
        socket.to(to).emit('ice-candidate', {
            candidate: candidate,
            from: socket.id
        });
    });

    // Chat messages
    socket.on('chat-message', ({ roomId, message }) => {
        io.to(roomId).emit('chat-message', {
            userName: socket.userName,
            message: message,
            timestamp: new Date().toISOString(),
            userId: socket.id
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        if (socket.roomId && rooms.has(socket.roomId)) {
            rooms.get(socket.roomId).delete(socket.id);

            // Clean up empty rooms
            if (rooms.get(socket.roomId).size === 0) {
                rooms.delete(socket.roomId);
            } else {
                // Notify others
                socket.to(socket.roomId).emit('user-disconnected', {
                    userId: socket.id,
                    userName: socket.userName
                });
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`🎥 Shaji Video Call server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
});
