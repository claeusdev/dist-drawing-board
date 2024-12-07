import Redis from 'ioredis';

const redis = new Redis({
	host: process.env.REDIS_HOST || 'redis-master',  // Use service name
	port: 6379,
	retryStrategy: (times) => {
		const delay = Math.min(times * 50, 2000);
		return delay;
	}
});

redis.on('error', (error) => {
	console.error('Redis connection error:', error);
});

redis.on('connect', () => {
	console.log('Successfully connected to Redis');
});

export { redis };
