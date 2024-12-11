// config/config.js
const config = {
	kafka: {
		brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
		clientId: 'whiteboard-service',
		topics: {
			events: 'whiteboard-events'
		}
	},
	redis: {
		host: process.env.REDIS_HOST || 'localhost',
		port: parseInt(process.env.REDIS_PORT || '6379')
	},
	mongodb: {
		uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
		database: process.env.MONGODB_DATABASE || 'whiteboard'
	},
	websocket: {
		port: parseInt(process.env.WS_PORT || '8080'),
		heartbeat: 30000
	}
};

export default config;
