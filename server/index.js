const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const connectDB = require('../config/database');

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

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'diablo-web-secret-key-2024';

// Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Inicialização assíncrona
async function startServer() {
  try {
    // Conectar ao MongoDB
    const db = await connectDB();
    console.log('✅ Database conectado - Diablo Web Online!');
    
    // Disponibilizar db para as rotas
    app.locals.db = db;

    // Routes

    // Health check
    app.get('/api/health', async (req, res) => {
      try {
        // Testar conexão com o banco
        await db.command({ ping: 1 });
        
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
    app.post('/api/auth/register', async (req, res) => {
      try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
          return res.status(400).json({ error: 'Username, email and password required' });
        }

        if (password.length < 6) {
          return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existingUser = await db.collection('users').findOne({ 
          $or: [{ username }, { email }] 
        });
        
        if (existingUser) {
          return res.status(400).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = {
          username,
          email,
          password: hashedPassword,
          createdAt: new Date(),
          lastLogin: new Date(),
        };

        const result = await db.collection('users').insertOne(user);
        const userId = result.insertedId;

        const token = jwt.sign({ userId: userId.toString() }, JWT_SECRET, { expiresIn: '7d' });
        
        res.status(201).json({ 
          token, 
          user: { 
            id: userId, 
            username: user.username,
            email: user.email
          } 
        });
      } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/auth/login', async (req, res) => {
      try {
        const { username, password } = req.body;
        
        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password required' });
        }

        const user = await db.collection('users').findOne({ 
          $or: [{ username }, { email: username }] 
        });
        
        if (!user) {
          return res.status(400).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await db.collection('users').updateOne(
          { _id: user._id },
          { $set: { lastLogin: new Date() } }
        );

        const token = jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ 
          token, 
          user: { 
            id: user._id, 
            username: user.username,
            email: user.email
          } 
        });
      } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Save Game Routes
    app.get('/api/saves', authenticateToken, async (req, res) => {
      try {
        const saves = await db.collection('savegames')
          .find({ userId: req.user.userId })
          .project({ saveData: 0 }) // Excluir dados binários da lista
          .sort({ lastSaved: -1 })
          .toArray();
        
        res.json(saves);
      } catch (error) {
        console.error('Error fetching saves:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.get('/api/saves/:id', authenticateToken, async (req, res) => {
      try {
        const save = await db.collection('savegames').findOne({ 
          _id: new require('mongodb').ObjectId(req.params.id), 
          userId: req.user.userId 
        });
        
        if (!save) {
          return res.status(404).json({ error: 'Save not found' });
        }

        res.set({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${save.characterName}.sv"`
        });
        
        res.send(save.saveData.buffer);
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

        // Check if save already exists for this character
        const existingSave = await db.collection('savegames').findOne({ 
          userId: req.user.userId, 
          characterName 
        });

        let saveGame;
        if (existingSave) {
          // Update existing save
          await db.collection('savegames').updateOne(
            { _id: existingSave._id },
            { 
              $set: { 
                saveData: buffer,
                level: level,
                lastSaved: new Date()
              } 
            }
          );
          saveGame = await db.collection('savegames').findOne({ _id: existingSave._id });
        } else {
          // Create new save
          saveGame = {
            userId: req.user.userId,
            characterName,
            characterClass,
            level,
            saveData: buffer,
            lastSaved: new Date(),
            gameVersion: '1.0'
          };
          const result = await db.collection('savegames').insertOne(saveGame);
          saveGame._id = result.insertedId;
        }

        res.status(201).json({ 
          message: 'Game saved successfully', 
          save: {
            id: saveGame._id,
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
        const result = await db.collection('savegames').deleteOne({ 
          _id: new require('mongodb').ObjectId(req.params.id), 
          userId: req.user.userId 
        });
        
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Save not found' });
        }
        
        res.json({ message: 'Save deleted successfully' });
      } catch (error) {
        console.error('Error deleting save:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Multiplayer Rooms Routes
    app.get('/api/multiplayer/rooms', async (req, res) => {
      try {
        const rooms = await db.collection('multiplayerrooms')
          .find({ 
            status: 'waiting', 
            isPublic: true 
          })
          .sort({ createdAt: -1 })
          .toArray();
        
        // Populate host info
        for (let room of rooms) {
          const host = await db.collection('users').findOne(
            { _id: new require('mongodb').ObjectId(room.host) },
            { projection: { username: 1 } }
          );
          room.host = host;
        }
        
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

        const user = await db.collection('users').findOne(
          { _id: new require('mongodb').ObjectId(req.user.userId) }
        );
        
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        const room = {
          name,
          host: req.user.userId,
          maxPlayers: maxPlayers || 4,
          isPublic: isPublic !== false,
          password: password || undefined,
          players: [{
            userId: req.user.userId,
            playerName: req.body.playerName || user.username,
            characterClass: req.body.characterClass || 'Warrior',
            level: req.body.level || 1,
            joinedAt: new Date(),
          }],
          status: 'waiting',
          createdAt: new Date(),
        };
        
        const result = await db.collection('multiplayerrooms').insertOne(room);
        room._id = result.insertedId;

        // Populate host for response
        const populatedRoom = { ...room };
        populatedRoom.host = { username: user.username };

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

        const room = await db.collection('multiplayerrooms').findOne(
          { _id: new require('mongodb').ObjectId(roomId) }
        );
        
        if (!room) {
          return res.status(404).json({ error: 'Room not found' });
        }

        if (room.status !== 'waiting') {
          return res.status(400).json({ error: 'Room is not accepting players' });
        }

        if (room.players.length >= room.maxPlayers) {
          return res.status(400).json({ error: 'Room is full' });
        }

        if (room.password && room.password !== password) {
          return res.status(401).json({ error: 'Invalid room password' });
        }

        // Check if player already in room
        const existingPlayer = room.players.find(p => 
          p.userId && p.userId.toString() === req.user.userId
        );
        
        if (existingPlayer) {
          return res.status(400).json({ error: 'Already in room' });
        }

        const newPlayer = {
          userId: req.user.userId,
          playerName,
          characterClass: characterClass || 'Warrior',
          level: level || 1,
          joinedAt: new Date(),
        };

        await db.collection('multiplayerrooms').updateOne(
          { _id: new require('mongodb').ObjectId(roomId) },
          { $push: { players: newPlayer } }
        );

        const updatedRoom = await db.collection('multiplayerrooms').findOne(
          { _id: new require('mongodb').ObjectId(roomId) }
        );

        // Populate host for response
        const host = await db.collection('users').findOne(
          { _id: new require('mongodb').ObjectId(updatedRoom.host) },
          { projection: { username: 1 } }
        );
        updatedRoom.host = host;

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
        const room = await db.collection('multiplayerrooms').findOne(
          { _id: new require('mongodb').ObjectId(roomId) }
        );
        
        if (!room) {
          return res.status(404).json({ error: 'Room not found' });
        }

        await db.collection('multiplayerrooms').updateOne(
          { _id: new require('mongodb').ObjectId(roomId) },
          { $pull: { players: { userId: req.user.userId } } }
        );

        const updatedRoom = await db.collection('multiplayerrooms').findOne(
          { _id: new require('mongodb').ObjectId(roomId) }
        );

        if (!updatedRoom || updatedRoom.players.length === 0) {
          // Delete empty room
          await db.collection('multiplayerrooms').deleteOne(
            { _id: new require('mongodb').ObjectId(roomId) }
          );
          io.emit('room-closed', roomId);
        } else {
          // If host left, assign new host
          if (room.host.toString() === req.user.userId) {
            await db.collection('multiplayerrooms').updateOne(
              { _id: new require('mongodb').ObjectId(roomId) },
              { $set: { host: updatedRoom.players[0].userId } }
            );
          }
          io.to(roomId).emit('player-left', updatedRoom);
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