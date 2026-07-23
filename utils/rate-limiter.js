export class RateLimiter {
  constructor(config) {
    this.requestsPerMinute = config.requestsPerMinute || 60;
    this.requestsPerSecond = config.requestsPerSecond || 5;
    this.requestTimes = [];
    this.queue = Promise.resolve();
    this.backoffUntil = null;
  }

  async acquire() {
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (this.backoffUntil && Date.now() < this.backoffUntil) {
        const waitTime = this.backoffUntil - Date.now();
        await this.delay(waitTime);
      }
      
      const now = Date.now();
      this.requestTimes = this.requestTimes.filter(time => now - time < 60000);
      
      if (this.requestTimes.length >= this.requestsPerMinute) {
        const oldestRequest = this.requestTimes[0];
        const waitTime = 60000 - (now - oldestRequest);
        await this.delay(waitTime);
      }
      
      const recentRequests = this.requestTimes.filter(time => now - time < 1000);
      if (recentRequests.length >= this.requestsPerSecond) {
        await this.delay(1000);
      }
      
      this.requestTimes.push(Date.now());
      return true;
    });
    
    return this.queue;
  }

  async release() {
    // No-op. We should not clear backoffUntil here because backoff 
    // is set explicitly when a 429 is encountered and must be respected.
  }

  async backoff(seconds) {
    this.backoffUntil = Date.now() + (seconds * 1000);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
