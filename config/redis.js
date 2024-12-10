import Redis from 'ioredis';

// Create Redis instance with retries
const redis = new Redis({
	host: process.env.REDIS_HOST || 'redis-master',
	port: 6379,
	retryStrategy(times) {
		const maxRetryTime = 3000; // Maximum retry time in milliseconds
		const delay = Math.min(times * 500, maxRetryTime);
		console.log(`Retrying Redis connection in ${delay}ms...`);
		return delay;
	},
	maxRetriesPerRequest: null,
	showFriendlyErrorStack: true
});

redis.on('connect', () => {
	console.log('Successfully connected to Redis');
});

redis.on('error', (error) => {
	console.error('Redis connection error:', error);
});

export { redis };
