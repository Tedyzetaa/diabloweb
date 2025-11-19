const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/diablo_web';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
});

const SaveGameSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  characterName: { type: String, required: true },
  characterClass: { type: String, required: true },
  level: { type: Number, required: true },
  saveData: { type: Buffer, required: true },
  lastSaved: { type: Date, default: Date.now },
  gameVersion: { type: String, default: '1.0' },
});

const MultiplayerRoomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  players: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    playerName: String,
    characterClass: String,
    level: Number,
    joinedAt: { type: Date, default: Date.now },
  }],
  maxPlayers: { type: Number, default: 4 },
  isPublic: { type: Boolean, default: true },
  status: { type: String, enum: ['waiting', 'in-game', 'closed'], default: 'waiting' },
  password: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);
const SaveGame = mongoose.model('SaveGame', SaveGameSchema);
const MultiplayerRoom = mongoose.model('MultiplayerRoom', MultiplayerRoomSchema);

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

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
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

    const existingUser = await User.findOne({ 
      $or: [{ username }, { email }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    
    res.status(201).json({ 
      token, 
      user: { 
        id: user._id, 
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

    const user = await User.findOne({ 
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
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    
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
    const saves = await SaveGame.find({ userId: req.user.userId })
      .select('-saveData')
      .sort({ lastSaved: -1 });
    
    res.json(saves);
  } catch (error) {
    console.error('Error fetching saves:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/saves/:id', authenticateToken, async (req, res) => {
  try {
    const save = await SaveGame.findOne({ 
      _id: req.params.id, 
      userId: req.user.userId 
    });
    
    if (!save) {
      return res.status(404).json({ error: 'Save not found' });
    }

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${save.characterName}.sv"`
    });
    
    res.send(save.saveData);
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
    const existingSave = await SaveGame.findOne({ 
      userId: req.user.userId, 
      characterName 
    });

    let saveGame;
    if (existingSave) {
      // Update existing save
      existingSave.saveData = buffer;
      existingSave.level = level;
      existingSave.lastSaved = new Date();
      saveGame = await existingSave.save();
    } else {
      // Create new save
      saveGame = new SaveGame({
        userId: req.user.userId,
        characterName,
        characterClass,
        level,
        saveData: buffer,
      });
      await saveGame.save();
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
    const save = await SaveGame.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user.userId 
    });
    
    if (!save) {
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
    const rooms = await MultiplayerRoom.find({ 
      status: 'waiting', 
      isPublic: true 
    })
      .populate('host', 'username')
      .select('-password')
      .sort({ createdAt: -1 });
    
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

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const room = new MultiplayerRoom({
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
      }],
    });
    
    await room.save();

    const populatedRoom = await MultiplayerRoom.findById(room._id)
      .populate('host', 'username')
      .select('-password');

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

    const room = await MultiplayerRoom.findById(roomId);
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

    room.players.push({
      userId: req.user.userId,
      playerName,
      characterClass: characterClass || 'Warrior',
      level: level || 1,
    });
    
    await room.save();

    const populatedRoom = await MultiplayerRoom.findById(room._id)
      .populate('host', 'username')
      .select('-password');

    io.to(roomId).emit('player-joined', populatedRoom);
    res.json(populatedRoom);
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/multiplayer/rooms/leave', authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.body;
    const room = await MultiplayerRoom.findById(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    room.players = room.players.filter(p => 
      p.userId.toString() !== req.user.userId
    );
    
    if (room.players.length === 0) {
      // Delete empty room
      await MultiplayerRoom.findByIdAndDelete(roomId);
      io.emit('room-closed', roomId);
    } else {
      // If host left, assign new host
      if (room.host.toString() === req.user.userId) {
        room.host = room.players[0].userId;
      }
      await room.save();
      io.to(roomId).emit('player-left', room);
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Diablo Web backend running on port ${PORT}`);
  console.log(`MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
});

module.exports = app;