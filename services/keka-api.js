import { RateLimiter } from '../utils/rate-limiter.js';

export class KekaAPIClient {
  constructor(config) {
    this.companyName = config.companyName || '';
    this.clientId = config.clientId || '';
    this.clientSecret = config.clientSecret || '';
    this.apiKey = config.apiKey || '';
    this.environment = config.environment || 'keka.com';
    this.baseUrl = `https://${this.companyName}.${this.environment}/api`;
    this.tokenUrl = `https://login.${this.environment}/connect/token`;
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 60,
      requestsPerSecond: 5
    });
    
    // Cache the token in memory for the lifecycle of the service worker
    this.accessToken = null;
    this.tokenExpiresAt = null;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiresAt > Date.now()) {
      return this.accessToken;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'kekaapi');
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('api_key', this.apiKey);
    params.append('scope', 'kekaapi');

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`Failed to get Keka access token: ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000) - 60000;
    
    return this.accessToken;
  }

  async getHeaders() {
    const token = await this.getAccessToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }
  async fetchWithRetry(url, options, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
      const response = await fetch(url, options);
      if (response.status === 429) {
        if (i === maxRetries - 1) throw new Error(`Keka API Error: 429 Too Many Requests (after ${maxRetries} retries)`);
        
        // Use Retry-After header if available, otherwise exponential backoff (3s, 6s, 12s, 24s)
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, i) * 3000;
        
        console.warn(`Rate limited (429). Retrying in ${delay}ms...`);
        this.rateLimiter.backoff(delay / 1000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return response;
    }
  }

  async healthCheck() {
    await this.rateLimiter.acquire();
    try {
      const response = await fetch(`${this.baseUrl}/v1/hire/jobs?pageNumber=1&pageSize=1`, {
        method: 'GET',
        headers: await this.getHeaders()
      });
      if (!response.ok) throw new Error(`Keka Connection Error: ${response.status} ${response.statusText}`);
      return true;
    } finally {
      await this.rateLimiter.release();
    }
  }

  async getJobs() {
    await this.rateLimiter.acquire();
    try {
      const response = await fetch(`${this.baseUrl}/v1/hire/jobs`, {
        method: 'GET',
        headers: await this.getHeaders()
      });
      if (!response.ok) throw new Error(`Keka API Error: ${response.statusText}`);
      const data = await response.json();
      return data.data || [];
    } finally {
      await this.rateLimiter.release();
    }
  }

  async getJobCandidates(jobId, stage = 'Applied') {
    let allCandidates = [];
    let pageNumber = 1;
    let hasMore = true;

    while (hasMore) {
      await this.rateLimiter.acquire();
      try {
        const response = await fetch(`${this.baseUrl}/v1/hire/jobs/${jobId}/candidates?pageNumber=${pageNumber}&pageSize=100`, {
          method: 'GET',
          headers: await this.getHeaders()
        });
        if (!response.ok) throw new Error(`Keka API Error: ${response.statusText}`);
        
        const data = await response.json();
        const candidates = data.data || [];
        allCandidates = allCandidates.concat(candidates);

        if (candidates.length < 100 || data.nextPage === null) {
          hasMore = false;
        } else {
          pageNumber++;
        }
      } finally {
        await this.rateLimiter.release();
      }
      
      // Safety limit to avoid infinite loops (max 2000 candidates)
      if (pageNumber > 20) break;
    }

    // Temporarily disable stage filtering so all candidates populate
    // if (stage) {
    //    const matchStage = stage.toLowerCase();
    //    return allCandidates.filter(c => {
    //      const fields = [c.stage, c.status, c.stageTitle, c.statusTitle, c.currentStage, c.step];
    //      return fields.some(f => typeof f === 'string' && f.toLowerCase().includes(matchStage));
    //    });
    // }
    return allCandidates;
  }

  async getCandidateResume(candidateId) {
    await this.rateLimiter.acquire();
    try {
      const response = await fetch(`${this.baseUrl}/v1/hire/jobs/candidate/${candidateId}/resume`, {
        method: 'GET',
        headers: await this.getHeaders()
      });
      if (!response.ok) throw new Error(`Keka API Error: ${response.statusText}`);
      
      const contentType = response.headers.get('content-type') || 'application/pdf';
      const buffer = await response.arrayBuffer(); 
      return { buffer, contentType };
    } finally {
      await this.rateLimiter.release();
    }
  }

  async postCandidateNote(jobId, candidateId, noteContent, tags = []) {
    await this.rateLimiter.acquire();
    try {
      const doRequest = async (requestTags) => {
        const body = { comments: noteContent };
        if (requestTags && requestTags.length > 0) {
          body.tags = requestTags;
        }
        
        const response = await this.fetchWithRetry(`${this.baseUrl}/v1/hire/jobs/${jobId}/candidate/${candidateId}/notes`, {
          method: 'POST',
          headers: await this.getHeaders(),
          body: JSON.stringify(body)
        });
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          return { ok: false, status: response.status, statusText: response.statusText, errorText };
        }
        
        return { ok: true, data: await response.json() };
      };

      let result = await doRequest(tags);

      // Handle 409 Tag Validation Error by retrying without tags
      if (!result.ok && result.status === 409 && result.errorText.includes('already exist')) {
        console.warn(`Tags already exist for candidate ${candidateId}. Retrying without tags...`);
        result = await doRequest([]);
      }

      if (!result.ok) {
        throw new Error(`Keka API Error: ${result.status} ${result.statusText || ''} - ${result.errorText}`);
      }

      return result.data;
    } finally {
      await this.rateLimiter.release();
    }
  }
}
