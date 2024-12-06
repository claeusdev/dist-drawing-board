class ServiceDiscovery {
  constructor() {
    this.services = new Map();
  }

  async register(serviceId, metadata) {
    this.services.set(serviceId, {
      ...metadata,
      timestamp: Date.now()
    });
    return {
      // Return a lease-like object for API compatibility
      revoke: async () => {
        this.services.delete(serviceId);
      }
    };
  }

  async discover(serviceType) {
    const services = [];
    for (const [id, metadata] of this.services.entries()) {
      if (metadata.type === serviceType) {
        services.push({ id, ...metadata });
      }
    }
    return services;
  }
}

export default new ServiceDiscovery();
