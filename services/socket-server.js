import WebSocket, { WebSocketServer } from 'ws';
import { kafka, createTopics } from '../config/kafka.js';
import redis from '../config/redis.js';
import serviceDiscovery from '../config/service-discovery.js';

class SocketServer {
  constructor(port) {
    this.port = port;
    this.producer = null;
    this.wss = null;
    this.rooms = new Map();
    this.sessionStore = new Map();
    this.app = express();
    this.server = http.createServer(this.app);
  }

  setupHealthCheck() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const health = {
        status: 'OK',
        timestamp: new Date(),
        serverId: process.pid,
        connections: this.wss?.clients.size || 0,
        roomCount: this.rooms.size,
        uptime: process.uptime()
      };

      // Check Kafka connection
      if (!this.producer?.isConnected()) {
        health.status = 'DEGRADED';
        health.kafkaStatus = 'DISCONNECTED';
      }

      // Check Redis connection
      redis.ping().then(() => {
        health.redisStatus = 'CONNECTED';
      }).catch(() => {
        health.status = 'DEGRADED';
        health.redisStatus = 'DISCONNECTED';
      });

      res.json(health);
    });

    // Liveness probe
    this.app.get('/live', (req, res) => {
      res.status(200).send('OK');
    });

    // Readiness probe
    this.app.get('/ready', async (req, res) => {
      try {
        await redis.ping();
        if (this.producer?.isConnected()) {
          res.status(200).send('OK');
        } else {
          res.status(503).send('Not Ready');
        }
      } catch (error) {
        res.status(503).send('Not Ready');
      }
    });
  }


  setupSessionReplication() {
    // Subscribe to session replication channel
    const subscriber = redis.duplicate();
    subscriber.subscribe('session:replication', (err) => {
      if (err) console.error('Error subscribing to session replication:', err);
    });

    subscriber.on('message', (channel, message) => {
      if (channel === 'session:replication') {
        try {
          const session = JSON.parse(message);
          if (session.serverId !== process.pid) {
            this.sessionStore.set(session.userId, session);
          }
        } catch (error) {
          console.error('Error processing replicated session:', error);
        }
      }
    });
  }

  async replicateSession(userId, sessionData) {
    try {
      await redis.publish('session:replication', JSON.stringify({
        serverId: process.pid,
        userId,
        ...sessionData
      }));
    } catch (error) {
      console.error('Error replicating session:', error);
    }
  }


  async start() {
    try {
      // Ensure Kafka topics exist
      await createTopics();

      // Initialize Kafka producer
      this.producer = kafka.producer();
      await this.producer.connect();
      console.log('Connected to Kafka');

      // Start WebSocket server
      this.wss = new WebSocketServer({
        port: process.env.PORT || 8080,
        perMessageDeflate: false
      });

      this.setupWebSocketHandlers();
      console.log(`WebSocket server started on port ${process.env.PORT || 8080}`);
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

    // Add session replication
    await this.replicateSession(data.userId, {
      roomId: data.roomId,
      joinedAt: Date.now()
    });
  }
  async handleLeave(ws) {
    if (ws.roomId) {
      const room = this.rooms.get(ws.roomId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) {
          this.rooms.delete(ws.roomId);
        }

        // Send leave event to Kafka
        try {
          await this.producer.send({
            topic: 'whiteboard-events',
            messages: [{
              key: String(ws.roomId),
              value: JSON.stringify({
                type: 'leave',
                roomId: ws.roomId,
                userId: ws.userId,
                timestamp: Date.now()
              })
            }]
          });
        } catch (error) {
          console.error('Error sending leave event to Kafka:', error);
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

// Start the server based on cluster configuration
if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  // Fork workers based on CPU cores
  const numCPUs = cpus().length;
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    // Fork a new worker if one dies
    cluster.fork();
  });
} else {
  // Workers can share any TCP connection
  // In this case, it's a WebSocket server
  const port = parseInt(process.env.PORT || '8080') + cluster.worker.id - 1;
  const server = new SocketServer(port);
  server.start().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export default SocketServer;
