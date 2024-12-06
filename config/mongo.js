import { MongoClient } from 'mongodb';

const url = 'mongodb://localhost:27017';
const client = new MongoClient(url, {
	useNewUrlParser: true,
	useUnifiedTopology: true
});

export default client;

