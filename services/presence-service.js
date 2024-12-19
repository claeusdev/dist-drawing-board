import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { EventEmitter } from 'events';

class PresenceService extends EventEmitter {
	constructor() {
		super();
		super();
		this.redis = new Redis({
			host: process.env.REDIS_HOST || 'redis-master',  // Changed from localhost
			port: 6379,
			password: process.env.REDIS_PASSWORD || 'redispass',
			retryStrategy: (times) => {
				const delay = Math.min(times * 50, 2000);
				return delay;
			}
		});

		this.subscriberRedis = new Redis({
			host: process.env.REDIS_HOST || 'redis-master',  // Changed from localhost
			port: 6379,
			password: process.env.REDIS_PASSWORD || 'redispass'
		});

		this.kafka = new Kafka({
			clientId: 'whiteboard-presence',
			brokers: ['localhost:9092']
		});

		this.producer = null;
		this.consumer = null;
		this.heartbeatInterval = 30000; // 30 seconds
		this.cleanupInterval = 60000; // 60 seconds
	}

	async start() {
		try {
			// Initialize Kafka producer and consumer
			this.producer = this.kafka.producer();
			this.consumer = this.kafka.consumer({ groupId: 'presence-service' });

			await this.producer.connect();
			await this.consumer.connect();
			await this.consumer.subscribe({ topic: 'whiteboard-events' });

			// Subscribe to presence channels
			await this.subscriberRedis.subscribe('presence:join', 'presence:leave');

			this.setupEventHandlers();
			this.startCleanupInterval();

			console.log('Presence Service started successfully');
		} catch (error) {
			console.error('Error starting presence service:', error);
			throw error;
		}
	}

	setupEventHandlers() {
		// Handle Redis subscription messages
		this.subscriberRedis.on('message', async (channel, message) => {
			const data = JSON.parse(message);

			switch (channel) {
				case 'presence:join':
					await this.handleUserJoin(data);
					break;
				case 'presence:leave':
					await this.handleUserLeave(data);
					break;
			}
		});

		// Handle Kafka messages
		this.consumer.run({
			eachMessage: async ({ topic, partition, message }) => {
				const event = JSON.parse(message.value.toString());
				if (event.type === 'user_activity') {
					await this.updateUserActivity(event.userId, event.roomId);
				}
			}
		});
	}

	async handleUserJoin({ userId, roomId, metadata = {} }) {
		try {
			const timestamp = Date.now();

			// Add user to room set
			await this.redis.sadd(`room:${roomId}:users`, userId);

			// Set user metadata
			await this.redis.hset(`user:${userId}`, {
				roomId,
				lastSeen: timestamp,
				...metadata
			});

			// Update room metadata
			await this.redis.hincrby(`room:${roomId}:metadata`, 'activeUsers', 1);

			// Publish join event
			await this.producer.send({
				topic: 'whiteboard-events',
				messages: [{
					key: roomId,
					value: JSON.stringify({
						type: 'user_joined',
						userId,
						roomId,
						timestamp,
						metadata
					})
				}]
			});

			this.emit('user_joined', { userId, roomId, metadata });
		} catch (error) {
			console.error('Error handling user join:', error);
		}
	}

	async handleUserLeave({ userId, roomId }) {
		try {
			// Remove user from room
			await this.redis.srem(`room:${roomId}:users`, userId);

			// Clear user metadata
			await this.redis.del(`user:${userId}`);

			// Update room metadata
			await this.redis.hincrby(`room:${roomId}:metadata`, 'activeUsers', -1);

			// Publish leave event
			await this.producer.send({
				topic: 'whiteboard-events',
				messages: [{
					key: roomId,
					value: JSON.stringify({
						type: 'user_left',
						userId,
						roomId,
						timestamp: Date.now()
					})
				}]
			});

			this.emit('user_left', { userId, roomId });
		} catch (error) {
			console.error('Error handling user leave:', error);
		}
	}

	async updateUserActivity(userId, roomId) {
		try {
			const timestamp = Date.now();
			await this.redis.hset(`user:${userId}`, 'lastSeen', timestamp);

			// Update room activity
			await this.redis.hset(`room:${roomId}:metadata`, 'lastActivity', timestamp);
		} catch (error) {
			console.error('Error updating user activity:', error);
		}
	}

	startCleanupInterval() {
		// Periodically clean up inactive users
		setInterval(async () => {
			try {
				const inactiveThreshold = Date.now() - this.heartbeatInterval * 2;

				// Get all users
				const users = await this.redis.keys('user:*');

				for (const userKey of users) {
					const userData = await this.redis.hgetall(userKey);

					if (userData && userData.lastSeen && parseInt(userData.lastSeen) < inactiveThreshold) {
						// User is inactive, remove them
						const userId = userKey.split(':')[1];
						await this.handleUserLeave({
							userId,
							roomId: userData.roomId
						});
					}
				}
			} catch (error) {
				console.error('Error in cleanup interval:', error);
			}
		}, this.cleanupInterval);
	}

	// API Methods
	async getRoomUsers(roomId) {
		try {
			const userIds = await this.redis.smembers(`room:${roomId}:users`);
			const users = [];

			for (const userId of userIds) {
				const userData = await this.redis.hgetall(`user:${userId}`);
				if (userData) {
					users.push({ userId, ...userData });
				}
			}

			return users;
		} catch (error) {
			console.error('Error getting room users:', error);
			return [];
		}
	}

	async getUserPresence(userId) {
		try {
			const userData = await this.redis.hgetall(`user:${userId}`);
			return userData || null;
		} catch (error) {
			console.error('Error getting user presence:', error);
			return null;
		}
	}

	async getRoomMetadata(roomId) {
		try {
			return await this.redis.hgetall(`room:${roomId}:metadata`);
		} catch (error) {
			console.error('Error getting room metadata:', error);
			return null;
		}
	}

	async stop() {
		try {
			await this.producer.disconnect();
			await this.consumer.disconnect();
			await this.redis.quit();
			await this.subscriberRedis.quit();
			console.log('Presence Service stopped successfully');
		} catch (error) {
			console.error('Error stopping presence service:', error);
		}
	}
}

// Create and start the presence service
const presenceService = new PresenceService();
presenceService.start().catch(console.error);

// Handle process termination
process.on('SIGTERM', async () => {
	console.log('Received SIGTERM signal. Shutting down...');
	await presenceService.stop();
	process.exit(0);
});

process.on('SIGINT', async () => {
	console.log('Received SIGINT signal. Shutting down...');
	await presenceService.stop();
	process.exit(0);
});

export default PresenceService;
