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
    low_load: {
      executor: 'constant-vus',
      vus: 5,
      duration: '1m',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<500',    // 95% of requests under 500ms
      'p(99)<750',    // 99% under 750ms
      'avg<300',      // Average under 300ms
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

    sleep(5);

  } catch (error) {
    console.error('Request failed:', error);
    errorRate.add(1);
  }
} 


{/* 
    📊 Performance Summary:
        Metric | Value | Target | Status
        -------|--------|--------|--------
        Requests | 60 | - | ✅ Good sample size
        Min Response | 71ms | - | ✅ Excellent
        Average | 148ms | <300ms | ✅ Well under target
        P95 | 314ms | <500ms | ✅ Within target
        P99 | 576ms | <750ms | ✅ Within target
        Max | 726ms | - | ⚠️ Spike, but acceptable
        Standard Deviation | 102ms | - | ⚠️ Moderate variability

        🎯 Key Insights:
        Overall Performance: Excellent! Most metrics are well within targets
        Consistency:
        95% of requests complete in 314ms (very good)
        Only 1% of requests take longer than 576ms
        Standard deviation of 102ms shows some variability
        Areas to Watch:
        The gap between P95 (314ms) and Max (726ms) indicates occasional spikes
        Standard deviation (102ms) suggests room for more consistency
        
        🚦 Status: ✅ PASSED
        All thresholds met
        Performance is reliable
        Room for optimization but not critical
    
    */
    }