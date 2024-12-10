import WebSocket, { WebSocketServer } from 'ws';
import { kafka } from '../config/kafka.js';
import { redis } from '../config/redis.js';

class SocketServer {
  constructor() {
    this.producer = null;
    this.wss = null;
    this.port = process.env.PORT || 8080;
    this.rooms = new Map();
  }

  async connectKafka(retries = 5, delay = 5000) {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`Attempting to connect to Kafka (attempt ${i + 1}/${retries})`);
        this.producer = kafka.producer();
        await this.producer.connect();
        console.log('Successfully connected to Kafka');
        return;
      } catch (error) {
        console.error(`Failed to connect to Kafka (attempt ${i + 1}/${retries}):`, error.message);
        if (i < retries - 1) {
          console.log(`Retrying in ${delay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
  }

  async start() {
    try {
      // Wait for Kafka connection
      await this.connectKafka();

      // Initialize WebSocket server
      this.wss = new WebSocketServer({
        port: this.port,
        perMessageDeflate: false
      });

      console.log(`WebSocket server is listening on port ${this.port}`);

      this.setupWebSocketHandlers();
    } catch (error) {
      console.error('Error starting server:', error);
      throw error;
    }
  }

  setupWebSocketHandlers() {
    this.wss.on('connection', (ws) => {
      console.log('Client connected');

      ws.isAlive = true;
      ws.roomId = null;
      ws.userId = null;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('Error handling message:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    // Setup heartbeat interval
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  async handleMessage(ws, data) {
    try {
      switch (data.type) {
        case 'join':
          await this.handleJoin(ws, data);
          break;
        case 'draw':
          await this.handleDraw(ws, data);
          break;
        case 'leave':
          await this.handleLeave(ws);
          break;
        default:
          this.sendError(ws, 'Unknown message type');
      }
    } catch (error) {
      console.error('Error in handleMessage:', error);
      this.sendError(ws, 'Error processing message');
    }
  }

  async handleJoin(ws, data) {
    if (!data.roomId || !data.userId) {
      return this.sendError(ws, 'Missing roomId or userId');
    }

    ws.roomId = data.roomId;
    ws.userId = data.userId;

    if (!this.rooms.has(data.roomId)) {
      this.rooms.set(data.roomId, new Set());
    }
    this.rooms.get(data.roomId).add(ws);

    try {
      // Get current room state from Redis
      const redisKey = `room:${data.roomId}:state`;
      console.log('Getting room state from Redis:', redisKey);
      const roomState = await redis.hgetall(redisKey);
      console.log('Room state from Redis:', roomState);

      // Send current state to the joining user
      const stateEvents = [];
      for (const [eventKey, coordinates] of Object.entries(roomState)) {
        const timestamp = parseInt(eventKey.split(':')[1]);
        stateEvents.push({
          type: 'draw',
          coordinates: JSON.parse(coordinates),
          timestamp
        });
      }

      // Sort events by timestamp
      stateEvents.sort((a, b) => a.timestamp - b.timestamp);

      console.log('Sending initial state:', stateEvents.length, 'events');

      // Send initial state
      this.safeSend(ws, {
        type: 'init_state',
        events: stateEvents
      });

      // Send join confirmation
      this.safeSend(ws, {
        type: 'joined',
        roomId: data.roomId,
        userId: data.userId
      });

      // Notify other clients
      this.broadcastToRoom(data.roomId, {
        type: 'user_joined',
        userId: data.userId
      }, ws);

    } catch (error) {
      console.error('Error handling join:', error);
      this.sendError(ws, 'Failed to join room');
    }
  }

  async handleDraw(ws, data) {
    if (!ws.roomId || !ws.userId) {
      return this.sendError(ws, 'Not joined to a room');
    }

    console.log('Received draw event:', data);

    const drawEvent = {
      type: 'draw',
      userId: ws.userId,
      roomId: ws.roomId,
      coordinates: data.coordinates,
      timestamp: Date.now()
    };

    try {
      // Store in Redis
      const redisKey = `room:${ws.roomId}:state`;
      const eventKey = `draw:${drawEvent.timestamp}`;
      console.log('Storing in Redis:', redisKey, eventKey);

      await redis.hset(
        redisKey,
        eventKey,
        JSON.stringify(drawEvent.coordinates)
      );
      console.log('Successfully stored in Redis');

      // Send to Kafka
      console.log('Sending to Kafka');
      await this.producer.send({
        topic: 'whiteboard-events',
        messages: [{
          key: String(ws.roomId),
          value: JSON.stringify(drawEvent)
        }]
      });
      console.log('Successfully sent to Kafka');

      // Broadcast to room
      this.broadcastToRoom(ws.roomId, drawEvent, ws);
    } catch (error) {
      console.error('Error processing draw event:', error);
      this.sendError(ws, 'Failed to process draw event');
    }
  }

  handleLeave(ws) {
    if (ws.roomId) {
      const room = this.rooms.get(ws.roomId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          this.rooms.delete(ws.roomId);
        }
      }
    }
  }

  handleDisconnect(ws) {
    this.handleLeave(ws);
    ws.roomId = null;
    ws.userId = null;
  }

  safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }
  }

  sendError(ws, message) {
    this.safeSend(ws, {
      type: 'error',
      message
    });
  }

  broadcastToRoom(roomId, data, excludeWs = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const message = JSON.stringify(data);
    room.forEach(client => {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Error broadcasting to client:', error);
        }
      }
    });
  }
}

// Create and start server
const server = new SocketServer();
server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

export default SocketServer;
