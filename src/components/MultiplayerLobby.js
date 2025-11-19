import React, { useState, useEffect } from 'react';
import './MultiplayerLobby.scss';

const MultiplayerLobby = ({ onJoinRoom, onCreateRoom, onInviteFriend, visible, onClose }) => {
  const [rooms, setRooms] = useState([]);
  const [roomName, setRoomName] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    if (visible) {
      loadRooms();
      // Load saved player name
      const savedName = localStorage.getItem('diabloPlayerName');
      if (savedName) {
        setPlayerName(savedName);
      }
    }
  }, [visible]);

  const loadRooms = async () => {
    try {
      // TODO: Replace with actual API call
      const response = await fetch('/api/multiplayer/rooms');
      const data = await response.json();
      setRooms(data.rooms || []);
    } catch (error) {
      console.error('Failed to load rooms:', error);
      // Fallback to mock data
      setRooms([
        { id: '1', name: 'Warriors Guild', players: 3, maxPlayers: 4 },
        { id: '2', name: 'Rogues Den', players: 1, maxPlayers: 4 },
        { id: '3', name: 'Mages Tower', players: 4, maxPlayers: 4 },
      ]);
    }
  };

  const handleCreateRoom = async () => {
    if (!roomName.trim() || !playerName.trim()) return;

    setIsCreating(true);
    try {
      localStorage.setItem('diabloPlayerName', playerName);
      
      const roomData = {
        name: roomName,
        playerName: playerName,
        maxPlayers: 4,
        isPublic: true
      };

      // TODO: Replace with actual API call
      const response = await fetch('/api/multiplayer/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(roomData),
      });

      const room = await response.json();
      
      if (onCreateRoom) {
        onCreateRoom(room);
      }
    } catch (error) {
      console.error('Failed to create room:', error);
      // Fallback mock
      if (onCreateRoom) {
        onCreateRoom({
          id: 'mock-' + Date.now(),
          name: roomName,
          players: 1,
          maxPlayers: 4
        });
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (roomId) => {
    if (!playerName.trim()) return;

    setIsJoining(true);
    try {
      localStorage.setItem('diabloPlayerName', playerName);

      const joinData = {
        roomId,
        playerName
      };

      // TODO: Replace with actual API call
      const response = await fetch('/api/multiplayer/rooms/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(joinData),
      });

      const room = await response.json();
      
      if (onJoinRoom) {
        onJoinRoom(room);
      }
    } catch (error) {
      console.error('Failed to join room:', error);
      // Fallback mock
      if (onJoinRoom) {
        onJoinRoom({
          id: roomId,
          name: 'Mock Room',
          players: 2,
          maxPlayers: 4
        });
      }
    } finally {
      setIsJoining(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="multiplayer-lobby-overlay">
      <div className="multiplayer-lobby">
        <div className="lobby-header">
          <h2>Multiplayer Lobby</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="lobby-content">
          {/* Player Info */}
          <div className="player-info">
            <input
              type="text"
              placeholder="Your Name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="name-input"
            />
          </div>

          {/* Create Room */}
          <div className="create-room">
            <h3>Create Room</h3>
            <div className="create-form">
              <input
                type="text"
                placeholder="Room Name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="room-input"
              />
              <button 
                onClick={handleCreateRoom}
                disabled={!roomName.trim() || !playerName.trim() || isCreating}
                className="create-btn"
              >
                {isCreating ? 'Creating...' : 'Create Room'}
              </button>
            </div>
          </div>

          {/* Available Rooms */}
          <div className="available-rooms">
            <h3>Available Rooms ({rooms.length})</h3>
            <div className="rooms-list">
              {rooms.map(room => (
                <div key={room.id} className="room-item">
                  <div className="room-info">
                    <span className="room-name">{room.name}</span>
                    <span className="room-players">
                      {room.players}/{room.maxPlayers} players
                    </span>
                  </div>
                  <button
                    onClick={() => handleJoinRoom(room.id)}
                    disabled={room.players >= room.maxPlayers || !playerName.trim() || isJoining}
                    className="join-btn"
                  >
                    {isJoining ? 'Joining...' : 'Join'}
                  </button>
                </div>
              ))}
              {rooms.length === 0 && (
                <div className="no-rooms">No rooms available</div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="quick-actions">
            <button onClick={onInviteFriend} className="invite-btn">
              Invite Friend
            </button>
            <button onClick={loadRooms} className="refresh-btn">
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiplayerLobby;