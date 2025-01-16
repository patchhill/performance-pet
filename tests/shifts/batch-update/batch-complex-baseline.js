import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { shiftIds } from '../../../shift-ids.js';

const slowResponseRate = new Rate('slow_responses');
const errorRate = new Rate('error_rate');

const API_KEY = __ENV.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}

export const options = {
  scenarios: {
    complex_updates: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1m',
      duration: '5m',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<2000',
      'p(99)<3000',
      'avg<1000',
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

function generateComplexUpdates(count = 50) {
  const updateScenarios = [
    // Scenario 1: Full update with all fields
    (id) => ({
      id,
      startTime: "09:00",
      endTime: "18:00",
      jobId: "clxwtgfi30002dq4qppn6iw8h",
      status: "available",
      rate: 200,
      cost: 299,
      metadata: {
        check: "system-shifts-test"
      },
      tags: [
        {
          name: "Testing40"
        }
      ]
    }),
    // Scenario 2: Time and Rate update
    (id) => ({
      id,
      startTime: "10:00",
      endTime: "19:00",
      rate: 225,
      cost: 325
    }),
    // Scenario 3: Status and Tags
    (id) => ({
      id,
      status: "confirmed",
      tags: [
        {
          name: "Testing40"
        }
      ]
    }),
    // Scenario 4: Booking with metadata
    (id) => ({
      id,
      bookCandidateId: "clxievkz500001em2gyoswdwq",
      metadata: {
        check: "system-shifts-test",
        updateType: "booking"
      }
    }),
    // Scenario 5: Custom fields and job update
    (id) => ({
      id,
      jobId: "clxb9aky80019l7pm0p6tn1ag",
      customFields: [
        {
          fieldId: "cm5xeds9v0000au5l69m1c0ra",
          value: `Job Update ${Date.now()}`
        }
      ]
    })
  ];

  const selectedShiftIds = [...shiftIds]
    .sort(() => Math.random() - 0.5)
    .slice(0, count);

  return selectedShiftIds.map(id => {
    const scenario = updateScenarios[Math.floor(Math.random() * updateScenarios.length)];
    return scenario(id);
  });
}

export default function () {
  const url = __ENV.API_URL + '/api/v1/shifts/batch/update';
  const payload = JSON.stringify({
    shifts: generateComplexUpdates()
  });
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  try {
    const response = http.patch(url, payload, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    // Detailed response logging
    if (response.status !== 200) {
      errorRate.add(1);
      console.log(`Error response: Status ${response.status}, Body: ${response.body}`);
    }

    if (response.timings.duration > 2000) {
      slowResponseRate.add(1);
      console.log(`Slow batch update: ${response.timings.duration}ms`);
    }

    check(response, {
      'is status 200': (r) => r.status === 200,
      'response time < 2000ms': (r) => r.timings.duration < 2000,
      'batch update successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.success === true;
        } catch (e) {
          console.log('JSON parse error:', e);
          return false;
        }
      },
      'all shifts processed': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.length === 50;
        } catch (e) {
          return false;
        }
      }
    });

    sleep(6);

  } catch (error) {
    console.error('Request failed:', error);
    errorRate.add(1);
  }
} 

{/*
### Test Results
- Status: 200 ✅ (All requests successful)
- Count: 50 batch requests
- Min: 824ms
- Average: 1s
- StdDev: 331ms (Higher variance)
- P95: 2s
- P99: 2s
- Max: 2s

### Key Insights
1. Performance Comparison
   - Complex updates are ~1.7x slower than simple updates
   - Simple: 587ms avg vs Complex: 1000ms avg
   - Higher variance in complex updates (StdDev: 331ms vs 68ms)

2. Performance Metrics
   - Wider performance band (824ms - 2000ms)
   - Higher but consistent ceiling at 2s
   - More variable response times (higher StdDev)

3. Thresholds Status
   - ✅ P95 < 2000ms (At threshold)
   - ✅ P99 < 3000ms (Well under)
   - ❌ Average < 1000ms (At threshold)
   - ✅ Error rate < 1% (No errors)
  */
 }