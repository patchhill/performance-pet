import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const slowResponseRate = new Rate('slow_responses');
const errorRate = new Rate('error_rate');
const rateLimitRate = new Rate('rate_limit_hits');

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
      executor: 'constant-arrival-rate',
      rate: 90,
      timeUnit: '1m',
      duration: '2m',
      preAllocatedVUs: 10,
      maxVUs: 15,
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<500',
      'p(99)<750',
      'avg<350',
    ],
    'rate_limit_hits': ['rate<0.05'],
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

    if (response.status === 429) {
      rateLimitRate.add(1);
      console.log('Rate limit hit');
      return;
    }

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

  } catch (error) {
    console.error('Request failed:', error);
    errorRate.add(1);
  }
} 

{/*

📊 Performance Analysis:
Metric | Previous | New | Improvement | Target | Status
-------|-----------|-----|-------------|---------|--------
Requests | 163 | 181 | +11% | 180 | ✅ Perfect
Min | 50ms | 48ms | +4% | - | ✅ Excellent
Average | 116ms | 65ms | +44% | <350ms | ✅ Outstanding
P95 | 167ms | 110ms | +34% | <500ms | ✅ Excellent
P99 | 679ms | 216ms | +68% | <750ms | ✅ Outstanding
Max | 1s | 251ms | +75% | - | ✅ Dramatic improvement
StdDev | 143ms | 27ms | +81% | - | ✅ Much more consistent

    */}