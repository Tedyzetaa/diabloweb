const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const connectDB = require('./config/database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Firebase Auth Middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const db = app.locals.db;
    const admin = require('firebase-admin');
    const decodedToken = await admin.auth().verifyIdToken(token);
    const user = { uid: decodedToken.uid, email: decodedToken.email };
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Inicialização assíncrona
async function startServer() {
  try {
    // Conectar ao MongoDB
    const db = await connectDB();
    console.log('✅ Firestore Database conectado - Diablo Web Online!');
    
    // Disponibilizar db para as rotas
    app.locals.db = db;

    // Routes

    // Health check
    app.get('/api/health', async (req, res) => {
      try {
        // Testar conexão com o banco
        await db.collection('health_check').get();
        
        res.json({ 
          status: '✅ Online', 
          database: 'MongoDB Atlas Connected',
          project: 'Diablo Web',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ 
          status: '❌ Database Error', 
          error: error.message 
        });
      }
    });

    // Auth Routes
    app.post('/api/auth/verify-token', authenticateToken, async (req, res) => {
      try {
        const { uid, email, displayName, photoURL } = req.user;
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        let userData;

        if (!userDoc.exists) {
          // Create new user in Firestore
          userData = {
            uid,
            email,
            displayName,
            photoURL,
            createdAt: new Date(),
            lastLogin: new Date(),
          };
          await userRef.set(userData);
        } else {
          // Update last login
          userData = userDoc.data();
          await userRef.update({ lastLogin: new Date() });
        }

        res.status(200).json({ user: userData });
      } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Save Game Routes
    app.get('/api/saves', authenticateToken, async (req, res) => {
      try {
        const savesSnapshot = await db.collection('savegames')
          .where('userId', '==', req.user.uid)
          .orderBy('lastSaved', 'desc')
          .get();
        
        const saves = savesSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            characterName: data.characterName,
            characterClass: data.characterClass,
            level: data.level,
            lastSaved: data.lastSaved.toDate(),
          };
        });
        
        res.json(saves);
      } catch (error) {
        console.error('Error fetching saves:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.get('/api/saves/:id', authenticateToken, async (req, res) => {
      try {
        const saveRef = db.collection('savegames').doc(req.params.id);
        const saveDoc = await saveRef.get();
        const save = saveDoc.data();

        if (!saveDoc.exists || save.userId !== req.user.uid) {
          return res.status(404).json({ error: 'Save not found' });
        }

        if (!save) {
          return res.status(404).json({ error: 'Save not found' });
        }

        res.set({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${save.characterName}.sv"`
        });
        
        res.send(Buffer.from(save.saveData, 'base64'));
      } catch (error) {
        console.error('Error fetching save data:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/saves', authenticateToken, async (req, res) => {
      try {
        const { characterName, characterClass, level, saveData } = req.body;
        
        if (!characterName || !characterClass || !level || !saveData) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        // Convert base64 save data to buffer
        const buffer = Buffer.from(saveData, 'base64');

        const savesRef = db.collection('savegames');
        const querySnapshot = await savesRef
          .where('userId', '==', req.user.uid)
          .where('characterName', '==', characterName)
          .limit(1)
          .get();

        let saveGame;
        if (!querySnapshot.empty) {
          // Update existing save
          const existingDoc = querySnapshot.docs[0];
          await existingDoc.ref.update({
            saveData: buffer.toString('base64'),
            level: level,
            lastSaved: new Date()
          });
          const updatedDoc = await existingDoc.ref.get();
          saveGame = { id: updatedDoc.id, ...updatedDoc.data() };
        } else {
          // Create new save
          saveGame = {
            userId: req.user.uid,
            characterName,
            characterClass,
            level,
            saveData: buffer.toString('base64'),
            lastSaved: new Date(),
            gameVersion: '1.0'
          };
          const docRef = await savesRef.add(saveGame);
          saveGame.id = docRef.id;
        }

        res.status(201).json({ 
          message: 'Game saved successfully', 
          save: {
            id: saveGame.id,
            characterName: saveGame.characterName,
            characterClass: saveGame.characterClass,
            level: saveGame.level,
            lastSaved: saveGame.lastSaved
          }
        });
      } catch (error) {
        console.error('Error saving game:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.delete('/api/saves/:id', authenticateToken, async (req, res) => {
      try {
        const saveRef = db.collection('savegames').doc(req.params.id);
        const saveDoc = await saveRef.get();

        if (!saveDoc.exists || saveDoc.data().userId !== req.user.uid) {
          return res.status(404).json({ error: 'Save not found' });
        }
        
        await saveRef.delete();
        
        res.json({ message: 'Save deleted successfully' });
      } catch (error) {
        console.error('Error deleting save:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Multiplayer Rooms Routes (Simplified for brevity, would need similar Firestore conversion)
    app.get('/api/multiplayer/rooms', async (req, res) => {
      try {
        const roomsSnapshot = await db.collection('multiplayerrooms')
          .where('status', '==', 'waiting')
          .where('isPublic', '==', true)
          .orderBy('createdAt', 'desc')
          .get();
        
        const rooms = await Promise.all(roomsSnapshot.docs.map(async (doc) => {
          const room = doc.data();
          const hostDoc = await db.collection('users').doc(room.host).get();
          const host = hostDoc.exists ? hostDoc.data() : { username: 'Unknown' };
          return {
            id: doc.id,
            ...room,
            host: { username: host.displayName },
          };
        }));
        
        res.json({ rooms });
      } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/multiplayer/rooms', authenticateToken, async (req, res) => {
      try {
        const { name, maxPlayers, isPublic, password } = req.body;
        
        if (!name) {
          return res.status(400).json({ error: 'Room name required' });
        }

        const userDoc = await db.collection('users').doc(req.user.uid).get();
        
        if (!userDoc.exists) {
          return res.status(404).json({ error: 'User not found' });
        }
        const user = userDoc.data();

        const room = {
          name,
          host: req.user.uid,
          maxPlayers: maxPlayers || 4,
          isPublic: isPublic !== false,
          password: password || null,
          players: [{
            userId: req.user.uid,
            playerName: req.body.playerName || user.displayName,
            characterClass: req.body.characterClass || 'Warrior',
            level: req.body.level || 1,
            joinedAt: new Date(),
          }],
          status: 'waiting',
          createdAt: new Date(),
        };
        
        const docRef = await db.collection('multiplayerrooms').add(room);
        room.id = docRef.id;

        const populatedRoom = { ...room, host: { username: user.displayName } };

        io.emit('room-created', populatedRoom);
        res.status(201).json(populatedRoom);
      } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/multiplayer/rooms/join', authenticateToken, async (req, res) => {
      try {
        const { roomId, playerName, characterClass, level, password } = req.body;
        
        if (!roomId || !playerName) {
          return res.status(400).json({ error: 'Room ID and player name required' });
        }

        const roomRef = db.collection('multiplayerrooms').doc(roomId);
        const roomDoc = await roomRef.get();
        
        if (!roomDoc.exists) {
          return res.status(404).json({ error: 'Room not found' });
        }
        const room = roomDoc.data();

        if (room.status !== 'waiting') {
          return res.status(400).json({ error: 'Room is not accepting players' });
        }

        if (room.players.length >= room.maxPlayers) {
          return res.status(400).json({ error: 'Room is full' });
        }

        if (room.password && room.password !== password) {
          return res.status(401).json({ error: 'Invalid room password' });
        }

        const existingPlayer = room.players.find(p => p.userId === req.user.uid);
        
        if (existingPlayer) {
          return res.status(400).json({ error: 'Already in room' });
        }

        const newPlayer = {
          userId: req.user.uid,
          playerName,
          characterClass: characterClass || 'Warrior',
          level: level || 1,
          joinedAt: new Date(),
        };

        await roomRef.update({
          players: admin.firestore.FieldValue.arrayUnion(newPlayer)
        });

        const updatedRoomDoc = await roomRef.get();
        const updatedRoom = updatedRoomDoc.data();

        const hostDoc = await db.collection('users').doc(updatedRoom.host).get();
        updatedRoom.host = hostDoc.exists ? { username: hostDoc.data().displayName } : { username: 'Unknown' };

        io.to(roomId).emit('player-joined', updatedRoom);
        res.json(updatedRoom);
      } catch (error) {
        console.error('Error joining room:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/multiplayer/rooms/leave', authenticateToken, async (req, res) => {
      try {
        const { roomId } = req.body;
        const roomRef = db.collection('multiplayerrooms').doc(roomId);
        const roomDoc = await roomRef.get();
        
        if (!roomDoc.exists) {
          return res.status(404).json({ error: 'Save not found' });
        }
        const room = roomDoc.data();
        const players = room.players.filter(p => p.userId !== req.user.uid);

        if (players.length === 0) {
          // Delete empty room
          await roomRef.delete();
          io.emit('room-closed', roomId);
        } else {
          // If host left, assign new host
          const newHost = room.host === req.user.uid ? players[0].userId : room.host;
          await roomRef.update({
            players: players,
            host: newHost
          });
          const updatedRoomDoc = await roomRef.get();
          const updatedRoom = updatedRoomDoc.data();
          if (updatedRoom) {
            io.to(roomId).emit('player-left', updatedRoom);
          }
        }

        res.json({ message: 'Left room successfully' });
      } catch (error) {
        console.error('Error leaving room:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Socket.IO for real-time communication
    io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId}`);
      });

      socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
        console.log(`User ${socket.id} left room ${roomId}`);
      });

      socket.on('game-event', (data) => {
        // Broadcast game events to other players in the same room
        socket.to(data.roomId).emit('game-event', data);
      });

      socket.on('chat-message', (data) => {
        // Broadcast chat messages to the room
        io.to(data.roomId).emit('chat-message', data);
      });

      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
      });
    });

    // Error handling middleware
    app.use((error, req, res, next) => {
      console.error('Unhandled error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });

    const PORT = process.env.PORT || 10000;
    
    server.listen(PORT, () => {
      console.log(`🎮 Diablo Web Server running on port ${PORT}`);
      console.log(`🚀 API Health: https://diablo-web-backend-rjqs.onrender.com/api/health`);
    });

  } catch (error) {
    console.error('❌ Falha ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;