import { Etcd3 } from 'etcd3';

class ServiceDiscovery {
	constructor() {
		this.client = new Etcd3({
			hosts: 'localhost:2379'
		});
	}

	async register(serviceId, metadata) {
		const lease = this.client.lease(30);
		await lease.put(`/services/${serviceId}`).value(JSON.stringify(metadata));
		return lease;
	}

	async discover(serviceType) {
		const services = await this.client.getAll().prefix(`/services/${serviceType}`);
		return Object.entries(services).map(([key, value]) => JSON.parse(value));
	}
}

export default new ServiceDiscovery();
