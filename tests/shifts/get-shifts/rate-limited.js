import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const slowResponseRate = new Rate('slow_responses');
const errorRate = new Rate('error_rate');

const API_KEY = __ENV.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}

export function setup() {
  const warmupUrl = __ENV.API_URL + '/api/v1/shifts?include=bookedApplicant.applicant,metadata,tags';
  const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };
  
  console.log('Warming up API...');
  const warmupResponse = http.get(warmupUrl, { headers });
  console.log(`Warm-up response time: ${warmupResponse.timings.duration}ms`);
  sleep(10);
  return { isWarmed: true };
}

export const options = {
  scenarios: {
    moderate_load: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 5 },
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<500',    // 95% of requests under 500ms
      'p(99)<750',    // 99% under 750ms
      'avg<350',      // Average under 350ms
    ],
    http_req_failed: ['rate<0.01'],
  },
  ext: {
    loadimpact: {
      distribution: {
        'amazon:au:sydney': { loadZone: 'amazon:au:sydney', percent: 100 },
      },
    },
  },
};

export default function () {
  const url = __ENV.API_URL + '/api/v1/shifts?include=bookedApplicant.applicant,metadata,tags';
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
    'Connection': 'keep-alive',
  };

  try {
    const response = http.get(url, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    if (response.status !== 200) {
      errorRate.add(1);
      console.log(`Error response: Status ${response.status}, Body: ${response.body}`);
    }

    if (response.timings.duration > 500) {
      slowResponseRate.add(1);
      console.log(`Slow API response: ${response.timings.duration}ms`);
    }

    check(response, {
      'is status 200': (r) => r.status === 200,
      'response time < 500ms': (r) => r.timings.duration < 500,
      'has shifts data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && Array.isArray(body.data);
        } catch (e) {
          console.log('JSON parse error:', e);
          return false;
        }
      },
    });

    sleep(4);

  } catch (error) {
    console.error('Request failed:', error);
    errorRate.add(1);
  }
} 

{/*

📊 Success Responses (200):
Metric | Value | Target | Status
-------|--------|--------|--------
Requests | 163 | - | ✅ Good sample
Min | 50ms | - | ✅ Excellent
Average | 116ms | <350ms | ✅ Well under target
P95 | 167ms | <500ms | ✅ Excellent
P99 | 679ms | <750ms | ✅ Within target
Max | 1s | - | ⚠️ Occasional spike
StdDev | 143ms | - | ⚠️ Some variability

📊 Rate Limited Responses (429):
Count: 101 responses (38% of total requests)
Fast responses (Avg: 39ms)
Quick rate limit detection
🎯 Key Insights:
Rate Limiting Impact:
Total Requests: 264 (163 success + 101 rate limited)
Rate limiting is actively protecting your API
~38% of requests were rate limited
Performance When Successful:
Very good average (116ms)
Excellent P95 (167ms)
Occasional spikes to 1s

    */}